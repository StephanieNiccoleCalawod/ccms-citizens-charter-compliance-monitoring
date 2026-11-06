import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, it } from 'node:test';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { ROLES, createMemoryStore, createRateLimiter, createTokenVerifier } from 'ccms-shared';
import { GET as jwksRoute } from '../src/app/api/auth/jwks/route.js';
import { POST as loginRoute, setLoginLimiter } from '../src/app/api/auth/login/route.js';
import { POST as logoutRoute } from '../src/app/api/auth/logout/route.js';
import { POST as refreshRoute } from '../src/app/api/auth/refresh/route.js';
import { GET as listRoute } from '../src/app/api/accounts/route.js';
import { OFFICE_A, PASSWORD, refreshTokenFrom, req, seedAccount, setupTestEnv } from './helpers.js';

let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());
afterEach(() => setLoginLimiter(null));

const login = (email, password, headers) => loginRoute(req('POST', '/auth/login', { body: { email, password }, headers }));
const refresh = (token) => refreshRoute(req('POST', '/auth/refresh', token ? { cookie: `ccms_refresh=${token}` } : {}));

describe('CC003 sign in and sign out', () => {
  it('AC1: valid credentials return an RS256 token with the documented claims and a refresh cookie', async () => {
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, email: 'staff@pup.edu.ph', fullName: 'Ana Cruz', employeeNo: 'EMP-777' });
    const response = await login('Staff@PUP.edu.ph', PASSWORD); // email is case-insensitive
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.expires_in, 900);
    assert.equal(body.user.role, ROLES.OFFICE_STAFF);
    assert.ok(!JSON.stringify(body).includes('refresh'), 'the refresh token must not be in the body');
    assert.ok(!JSON.stringify(body).includes('hash'));

    const header = decodeProtectedHeader(body.access_token);
    assert.equal(header.alg, 'RS256');
    assert.ok(header.kid);
    const claims = decodeJwt(body.access_token);
    assert.equal(claims.sub, staff.accountId);
    assert.equal(claims.employee_no, 'EMP-777');
    assert.equal(claims.full_name, 'Ana Cruz');
    assert.equal(claims.role, ROLES.OFFICE_STAFF);
    assert.equal(claims.office_id, OFFICE_A);
    assert.equal(claims.iss, 'ccms-identity');
    assert.equal(claims.aud, 'ccms');
    assert.equal(claims.exp - claims.iat, 15 * 60, 'access token lasts 15 minutes');

    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/identity\/auth/);
    assert.match(cookie, new RegExp(`Max-Age=${7 * 86400}`));
  });

  it('publishes public keys (JWKS) that let another service verify the token offline', async () => {
    const admin = await seedAccount(ds, { role: ROLES.EXECUTIVE });
    const { access_token } = await (await login(admin.email, PASSWORD)).json();

    const jwksResponse = await jwksRoute(req('GET', '/auth/jwks'));
    assert.equal(jwksResponse.status, 200);
    const jwks = await jwksResponse.json();
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0].alg, 'RS256');
    assert.ok(!('d' in jwks.keys[0]), 'the private key must never be published');

    const otherService = createTokenVerifier({ jwks });
    const user = await otherService(access_token);
    assert.equal(user.role, ROLES.EXECUTIVE);
  });

  it('a token issued by Identity opens the routes that require it, and a missing token is a 401', async () => {
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const { access_token } = await (await login(admin.email, PASSWORD)).json();
    assert.equal((await listRoute(req('GET', '/accounts', { token: access_token }))).status, 200);
    assert.equal((await listRoute(req('GET', '/accounts'))).status, 401);
  });

  it('AC2: wrong password, unknown email and deactivated account all show the same message and issue no token', async () => {
    const active = await seedAccount(ds);
    const inactive = await seedAccount(ds, { active: false });
    const attempts = [
      [active.email, 'wrong-password'],
      ['nobody@pup.edu.ph', PASSWORD],
      [inactive.email, PASSWORD],
      ['', ''],
    ];
    for (const [email, password] of attempts) {
      const response = await login(email, password);
      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.error.message, 'Incorrect email or password');
      assert.equal(body.error.code, 'INVALID_CREDENTIALS');
      assert.ok(!body.access_token);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  it('AC3: an expired access token is renewed from a valid refresh token without signing in again', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_HEAD });
    const first = await login(account.email, PASSWORD);
    const refreshToken = refreshTokenFrom(first);
    const renewed = await refresh(refreshToken);
    assert.equal(renewed.status, 200);
    const body = await renewed.json();
    assert.equal(decodeJwt(body.access_token).sub, account.accountId);
    assert.equal(body.user.role, ROLES.OFFICE_HEAD);
    const rotatedToken = refreshTokenFrom(renewed);
    assert.ok(rotatedToken);
    assert.notEqual(rotatedToken, refreshToken);
    assert.equal((await refresh(refreshToken)).status, 401, 'the old token cannot be reused');
    assert.equal((await refresh(rotatedToken)).status, 200, 'the replacement token continues the session');
  });

  it('a renewed token reflects the account as it is now (role changes apply on refresh)', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    const refreshToken = refreshTokenFrom(await login(account.email, PASSWORD));
    await ds.query(`UPDATE accounts SET role_key = 'office_head' WHERE account_id = $1`, [account.accountId]);
    const body = await (await refresh(refreshToken)).json();
    assert.equal(decodeJwt(body.access_token).role, ROLES.OFFICE_HEAD);
  });

  it('refresh tokens are stored hashed, never as the cookie value', async () => {
    const account = await seedAccount(ds);
    const refreshToken = refreshTokenFrom(await login(account.email, PASSWORD));
    const rows = await ds.query('SELECT token_hash FROM refresh_tokens WHERE account_id = $1', [account.accountId]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, refreshToken);
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  });

  it('AC4: an expired, revoked, missing or made-up refresh token returns the user to sign-in', async () => {
    const account = await seedAccount(ds);
    const token = refreshTokenFrom(await login(account.email, PASSWORD));

    await ds.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE account_id = $1`, [account.accountId]);
    for (const candidate of [token, 'made-up', null]) {
      const response = await refresh(candidate);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'INVALID_REFRESH_TOKEN');
      assert.match(response.headers.get('set-cookie'), /Max-Age=0/, 'the cookie is cleared');
    }
  });

  it('AC5: sign-out revokes the refresh token', async () => {
    const account = await seedAccount(ds);
    const token = refreshTokenFrom(await login(account.email, PASSWORD));
    const out = await logoutRoute(req('POST', '/auth/logout', { cookie: `ccms_refresh=${token}` }));
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await refresh(token)).status, 401);
    // Signing out twice, or without a session, is harmless.
    assert.equal((await logoutRoute(req('POST', '/auth/logout', { cookie: `ccms_refresh=${token}` }))).status, 204);
    assert.equal((await logoutRoute(req('POST', '/auth/logout'))).status, 204);
  });

  it('API clients can send the refresh token in the JSON body instead of the cookie', async () => {
    const account = await seedAccount(ds);
    const token = refreshTokenFrom(await login(account.email, PASSWORD));
    const response = await refreshRoute(req('POST', '/auth/refresh', { body: { refresh_token: token } }));
    assert.equal(response.status, 200);
  });

  it('AC7: there is no citizen sign-in anywhere', async () => {
    const response = await login('citizen@example.com', PASSWORD);
    assert.equal(response.status, 401);
    const { readdirSync, statSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    const files = walk(fileURLToPath(new URL('../src', import.meta.url))).filter((f) => /\.(js|jsx)$/.test(f));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // The only mention allowed is the test-visible "no Citizen role" rule comments; no route or role named citizen.
      assert.ok(!/role[^\n]*['"]citizen['"]/i.test(source), `${file} defines a citizen role`);
    }
  });

  it('sign-in and sign-out are not written to the audit trail', async () => {
    const account = await seedAccount(ds);
    const before = Number((await ds.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n);
    const token = refreshTokenFrom(await login(account.email, PASSWORD));
    await logoutRoute(req('POST', '/auth/logout', { cookie: `ccms_refresh=${token}` }));
    const after = Number((await ds.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n);
    assert.equal(after, before);
  });
});

describe('TT4 sign-in limiting and refresh rotation', () => {
  it('TC4-IDN-001: the sixth failure for an email is limited for 15 minutes, then the window resets', async () => {
    let now = 1_000_000;
    setLoginLimiter(createRateLimiter({ now: () => now, store: createMemoryStore(), failOpen: false }));
    const account = await seedAccount(ds);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await login(account.email.toUpperCase(), 'wrong-password', { 'x-forwarded-for': `10.0.0.${attempt}` });
      assert.equal(response.status, 401, `failure ${attempt} remains below the limit`);
    }

    const limited = await login(account.email, PASSWORD, { 'x-forwarded-for': '10.0.0.6' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '900');
    const body = await limited.json();
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.equal(body.error.message, 'Too many sign-in attempts. Try again in 900 seconds.');
    assert.equal(limited.headers.get('set-cookie'), null);

    now += 15 * 60_000;
    assert.equal((await login(account.email, 'wrong-password', { 'x-forwarded-for': '10.0.0.7' })).status, 401);
  });

  it('TC4-IDN-001: the sixth failure from one address is limited across different emails', async () => {
    setLoginLimiter(createRateLimiter({ store: createMemoryStore(), failOpen: false }));
    const ip = '10.1.2.3';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await login(`unknown-${attempt}@pup.edu.ph`, 'wrong-password', { 'x-forwarded-for': ip });
      assert.equal(response.status, 401);
    }
    assert.equal((await login('another@pup.edu.ph', 'wrong-password', { 'x-forwarded-for': ip })).status, 429);
  });

  it('successful sign-ins do not consume either failure budget', async () => {
    setLoginLimiter(createRateLimiter({ store: createMemoryStore(), failOpen: false }));
    const account = await seedAccount(ds);
    const ip = '10.2.3.4';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      assert.equal((await login(account.email, PASSWORD, { 'x-forwarded-for': ip })).status, 200);
    }
    assert.equal((await login(account.email, 'wrong-password', { 'x-forwarded-for': ip })).status, 401);
  });

  it('TC4-IDN-002: a wrong password below the limit keeps the generic 401 response', async () => {
    setLoginLimiter(createRateLimiter({ store: createMemoryStore(), failOpen: false }));
    const account = await seedAccount(ds);
    const response = await login(account.email, 'wrong-password', { 'x-forwarded-for': '10.3.4.5' });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(body.error.message, 'Incorrect email or password');
  });

  it('TC4-IDN-003: limiter-store failure closes sign-in with 503 and no token', async () => {
    const downStore = {
      async get() {
        throw new Error('store down');
      },
      async hit() {
        throw new Error('store down');
      },
      async reset() {},
    };
    setLoginLimiter(createRateLimiter({ store: downStore, failOpen: false }));
    const account = await seedAccount(ds);
    const response = await login(account.email, PASSWORD, { 'x-forwarded-for': '10.4.5.6' });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'SIGN_IN_UNAVAILABLE');
    assert.equal(body.error.message, 'Sign-in is temporarily unavailable. Please try again.');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.ok(!body.access_token);
  });

  it('TC4-IDN-004 and TC4-IDN-005: concurrent reuse lets one rotation win and rejects the other', async () => {
    const account = await seedAccount(ds);
    const token = refreshTokenFrom(await login(account.email, PASSWORD, { 'x-forwarded-for': '10.5.6.7' }));
    const responses = await Promise.all([refresh(token), refresh(token)]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 401],
    );
    const winner = responses.find((response) => response.status === 200);
    assert.ok(refreshTokenFrom(winner));
  });
});
