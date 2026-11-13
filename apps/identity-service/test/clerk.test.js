import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { ROLES } from 'ccms-shared';
import { PATCH as deactivateRoute } from '../src/app/api/accounts/[id]/deactivate/route.js';
import { POST as createRoute } from '../src/app/api/accounts/route.js';
import { POST as loginRoute, setLoginLimiter } from '../src/app/api/auth/login/route.js';
import { NO_PASSWORD_MARKER } from '../src/lib/accounts.js';
import { DELETE as unlinkRoute, PUT as linkRoute } from '../src/app/api/accounts/[id]/clerk-link/route.js';
import { POST as exchangeRoute, setExchangeLimiter } from '../src/app/api/auth/clerk/exchange/route.js';
import { GET as linksRoute } from '../src/app/api/clerk-access/links/route.js';
import { DELETE as dismissRoute } from '../src/app/api/clerk-access/requests/[id]/route.js';
import { GET as requestsRoute } from '../src/app/api/clerk-access/requests/route.js';
import { GET as meRoute } from '../src/app/api/me/route.js';
import { clerkSettings } from '../src/lib/clerk.js';
import { ctx, outboxEvents, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

// Clerk sign-in (Landas 1). Tokens are minted here with a throwaway RSA key that stands in for the Clerk instance key.
const ISSUER = 'https://example-instance-0000.clerk.accounts.dev';
const ORIGIN = 'http://localhost:3000';

let env;
let ds;
let key;
let otherKey;
const CLERK_ENV = ['CLERK_AUTH_ENABLED', 'CLERK_ISSUER', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_ALLOW_IMPERSONATION', 'CLERK_EMAIL_CLAIM'];

before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  key = await generateKeyPair('RS256', { extractable: true });
  otherKey = await generateKeyPair('RS256', { extractable: true });
});
after(() => env?.cleanup());

beforeEach(async () => {
  process.env.CLERK_AUTH_ENABLED = 'true';
  process.env.CLERK_ISSUER = ISSUER;
  process.env.CLERK_JWT_KEY = (await exportSPKI(key.publicKey)).replace(/\n/g, '\\n'); // as stored in a .env file
  process.env.CLERK_AUTHORIZED_PARTIES = `${ORIGIN}, https://cms.example.test`;
  delete process.env.CLERK_ALLOW_IMPERSONATION;
  delete process.env.CLERK_EMAIL_CLAIM;
  setExchangeLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
});
afterEach(async () => {
  for (const name of CLERK_ENV) delete process.env[name];
  setExchangeLimiter(null);
  await ds.query('DELETE FROM account_clerk_links');
  await ds.query('DELETE FROM clerk_access_requests');
});

let seq = 0;
const newSubject = () => `user_test${Date.now()}${(seq += 1)}`;

async function clerkToken(overrides = {}, { signWith = key.privateKey, alg = 'RS256', expiresIn = '60s' } = {}) {
  const claims = { azp: ORIGIN, sid: 'sess_test123', v: 2, email: 'person@example.test', ...overrides };
  for (const [name, value] of Object.entries(claims)) if (value === undefined) delete claims[name];
  const jwt = new SignJWT(claims).setProtectedHeader({ alg, kid: 'ins_test' }).setIssuer(overrides.iss ?? ISSUER).setIssuedAt();
  if (expiresIn) jwt.setExpirationTime(expiresIn);
  if (overrides.sub !== null) jwt.setSubject(overrides.sub ?? newSubject());
  return jwt.sign(signWith);
}

const exchange = (token) => exchangeRoute(req('POST', '/auth/clerk/exchange', { token }));
const codeOf = async (response) => (await response.json()).error?.code;
const admin = async () => {
  const account = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
  return { account, token: await tokenFor(account) };
};
/** A person signs in with Clerk once (pending request), then a Super Admin binds them to `account`. */
async function signInAndLink(account, adminToken, claims = {}) {
  const sub = claims.sub ?? newSubject();
  assert.equal((await exchange(await clerkToken({ ...claims, sub }))).status, 403);
  const res = await linkRoute(req('PUT', `/accounts/${account.accountId}/clerk-link`, { token: adminToken, body: { clerk_user_id: sub } }), ctx(account.accountId));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return sub;
}

describe('Clerk sign-in: switched off', () => {
  it('every Clerk route answers 404 while CLERK_AUTH_ENABLED is not "true"', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds);
    process.env.CLERK_AUTH_ENABLED = 'false';
    assert.equal((await exchange(await clerkToken())).status, 404);
    assert.equal((await requestsRoute(req('GET', '/clerk-access/requests', { token }))).status, 404);
    assert.equal((await linksRoute(req('GET', '/clerk-access/links', { token }))).status, 404);
    assert.equal((await linkRoute(req('PUT', `/accounts/${staff.accountId}/clerk-link`, { token, body: { clerk_user_id: 'user_x1' } }), ctx(staff.accountId))).status, 404);
  });
});

describe('Clerk sign-in: token verification', () => {
  it('a valid token for an unbound person is "No access yet" (403) and is recorded with the email as a hint', async () => {
    const sub = newSubject();
    const res = await exchange(await clerkToken({ sub, email: 'Mixed.Case@Example.Test' }));
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), 'CCMS_ACCESS_PENDING');
    const rows = await ds.query('SELECT clerk_issuer, email FROM clerk_access_requests WHERE clerk_user_id = $1', [sub]);
    assert.deepEqual(rows, [{ clerk_issuer: ISSUER, email: 'mixed.case@example.test' }]);
  });

  it('signing in again updates the same request instead of adding one', async () => {
    const sub = newSubject();
    await exchange(await clerkToken({ sub }));
    await exchange(await clerkToken({ sub, email: 'new@example.test' }));
    const rows = await ds.query('SELECT email FROM clerk_access_requests WHERE clerk_user_id = $1', [sub]);
    assert.deepEqual(rows, [{ email: 'new@example.test' }]);
  });

  const rejected = [
    ['no Authorization header', async () => null],
    ['a token that is not a JWT', async () => 'not-a-token'],
    ['another issuer (for example the production instance)', () => clerkToken({ iss: 'https://clerk.other.example' })],
    ['an origin that is not allowlisted (azp)', () => clerkToken({ azp: 'https://other-app.example.test' })],
    ['no azp claim', () => clerkToken({ azp: undefined })],
    ['an expired token', () => clerkToken({}, { expiresIn: '-30s' })],
    ['no expiry', () => clerkToken({}, { expiresIn: null })],
    ['a token signed by another key', () => clerkToken({}, { signWith: otherKey.privateKey })],
    ['a session still pending (sts)', () => clerkToken({ sts: 'pending' })],
    ['an unknown token version', () => clerkToken({ v: 1 })],
    ['no session id', () => clerkToken({ sid: undefined })],
    ['a subject that is not a Clerk user ID', () => clerkToken({ sub: 'admin' })],
  ];
  for (const [name, make] of rejected) {
    it(`rejects ${name} with 401 and records nothing`, async () => {
      const res = await exchange((await make()) ?? undefined);
      assert.equal(res.status, 401);
      assert.equal(await codeOf(res), 'INVALID_CLERK_TOKEN');
      assert.equal((await ds.query('SELECT count(*)::int AS n FROM clerk_access_requests'))[0].n, 0);
    });
  }

  it('rejects an HS256 token even when it carries valid-looking claims', async () => {
    const forged = await new SignJWT({ azp: ORIGIN, sid: 'sess_x', v: 2 })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setSubject(newSubject()).setIssuedAt().setExpirationTime('60s')
      .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length-000'));
    assert.equal((await exchange(forged)).status, 401);
  });

  it('refuses impersonation (act claim) unless explicitly allowed', async () => {
    const res = await exchange(await clerkToken({ act: { sub: 'user_dashboardmember1' } }));
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), 'IMPERSONATION_NOT_ALLOWED');
    process.env.CLERK_ALLOW_IMPERSONATION = 'true';
    assert.equal(await codeOf(await exchange(await clerkToken({ act: { sub: 'user_dashboardmember1' } }))), 'CCMS_ACCESS_PENDING');
  });

  it('accepts a token signed with either key during a rotation window', async () => {
    const both = `${await exportSPKI(otherKey.publicKey)}\n${await exportSPKI(key.publicKey)}`;
    process.env.CLERK_JWT_KEY = both;
    assert.equal(clerkSettings().jwtKeys.length, 2);
    assert.equal(await codeOf(await exchange(await clerkToken())), 'CCMS_ACCESS_PENDING');
    assert.equal(await codeOf(await exchange(await clerkToken({}, { signWith: otherKey.privateKey }))), 'CCMS_ACCESS_PENDING');
  });

  it('answers 503 (not 401) when the instance key is not configured', async () => {
    delete process.env.CLERK_JWT_KEY;
    const res = await exchange(await clerkToken());
    assert.equal(res.status, 503);
    assert.equal(await codeOf(res), 'CLERK_NOT_CONFIGURED');
  });

  it('treats an email marked unverified as no hint at all', async () => {
    const sub = newSubject();
    await exchange(await clerkToken({ sub, email_verified: false }));
    assert.deepEqual(await ds.query('SELECT email FROM clerk_access_requests WHERE clerk_user_id = $1', [sub]), [{ email: null }]);
  });

  it('answers 429 when the per-person limit is reached', async () => {
    setExchangeLimiter({ check: async () => ({ allowed: false, retryAfterSeconds: 9 }) });
    const res = await exchange(await clerkToken());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '9');
  });
});

describe('Clerk sign-in: binding by issuer + user ID (playbook R3)', () => {
  it('a matching email alone never grants access', async () => {
    const staff = await seedAccount(ds, { email: 'same@example.test' });
    const res = await exchange(await clerkToken({ email: 'same@example.test' }));
    assert.equal(await codeOf(res), 'CCMS_ACCESS_PENDING');
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM account_clerk_links WHERE account_id = $1', [staff.accountId]))[0].n, 0);
  });

  it('the Super Admin sees pending sign-ins with an exact-email suggestion (case-insensitive), not a fuzzy one', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'Exact.Match@Example.Test' });
    await seedAccount(ds, { email: 'exact.match.not@example.test' });
    const sub = newSubject();
    await exchange(await clerkToken({ sub, email: 'exact.match@example.test' }));
    const body = await (await requestsRoute(req('GET', '/clerk-access/requests', { token }))).json();
    const item = body.items.find((i) => i.clerk_user_id === sub);
    assert.equal(item.email, 'exact.match@example.test');
    assert.deepEqual(item.suggested_account, { account_id: staff.accountId, full_name: staff.fullName });
  });

  it('after the Super Admin binds the person, the exchange issues a CCMS token with the CCMS role and office, and no refresh cookie', async () => {
    const { token } = await admin();
    const head = await seedAccount(ds, { role: ROLES.OFFICE_HEAD });
    const sub = await signInAndLink(head, token);
    const res = await exchange(await clerkToken({ sub }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('set-cookie'), null);
    const body = await res.json();
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.user.id, head.accountId);
    assert.equal(body.user.role, ROLES.OFFICE_HEAD);
    assert.equal(body.user.office_id, head.officeId);
    // The issued token is an ordinary CCMS token: the existing verification accepts it.
    const me = await meRoute(req('GET', '/me', { token: body.access_token }));
    assert.equal(me.status, 200);
    assert.equal((await me.json()).account.account_id, head.accountId);
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM clerk_access_requests WHERE clerk_user_id = $1', [sub]))[0].n, 0);
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM account_last_login WHERE account_id = $1', [head.accountId]))[0].n, 1);
  });

  it('the binding follows the Clerk user ID, not the email: a later email change keeps access', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds);
    const sub = await signInAndLink(staff, token, { email: 'old@example.test' });
    assert.equal((await exchange(await clerkToken({ sub, email: 'renamed@example.test' }))).status, 200);
  });

  it('records ACCOUNT_CLERK_LINKED by account ID, without any email', async () => {
    const { account: actor, token } = await admin();
    const staff = await seedAccount(ds);
    const sub = await signInAndLink(staff, token);
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_LINKED')).find((e) => e.entity_id === staff.accountId);
    assert.equal(event.actor_user_id, actor.accountId);
    assert.deepEqual(event.after_value, { account_id: staff.accountId, clerk_user_id: sub });
    assert.ok(!JSON.stringify(event).includes('@'));
  });

  it('binds only a person who has signed in (a pending request), one-to-one in both directions', async () => {
    const { token } = await admin();
    const first = await seedAccount(ds);
    const second = await seedAccount(ds);
    const link = (account, clerkUserId) => linkRoute(req('PUT', `/accounts/${account.accountId}/clerk-link`, { token, body: { clerk_user_id: clerkUserId } }), ctx(account.accountId));

    assert.equal(await codeOf(await link(first, 'user_neversignedin1')), 'CLERK_REQUEST_NOT_FOUND');
    const sub = await signInAndLink(first, token);

    const other = newSubject();
    await exchange(await clerkToken({ sub: other }));
    assert.equal(await codeOf(await link(first, other)), 'ACCOUNT_ALREADY_LINKED');
    // The same Clerk user cannot be bound to a second account (its request is gone once bound).
    await ds.query('INSERT INTO clerk_access_requests (clerk_issuer, clerk_user_id) VALUES ($1, $2)', [ISSUER, sub]);
    assert.equal(await codeOf(await link(second, sub)), 'CLERK_USER_ALREADY_LINKED');
    assert.equal((await link(second, 'not-a-clerk-id')).status, 400);
  });

  it('refuses to bind a deactivated account', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { active: false });
    const sub = newSubject();
    await exchange(await clerkToken({ sub }));
    const res = await linkRoute(req('PUT', `/accounts/${staff.accountId}/clerk-link`, { token, body: { clerk_user_id: sub } }), ctx(staff.accountId));
    assert.equal(await codeOf(res), 'ACCOUNT_INACTIVE');
  });

  it('deactivating the CCMS account turns Clerk sign-in off for CCMS only (403 ACCOUNT_INACTIVE)', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds);
    const sub = await signInAndLink(staff, token);
    assert.equal((await deactivateRoute(req('PATCH', `/accounts/${staff.accountId}/deactivate`, { token }), ctx(staff.accountId))).status, 200);
    const res = await exchange(await clerkToken({ sub }));
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), 'ACCOUNT_INACTIVE');
  });

  it('removing a binding returns the person to "No access yet", is audited, and nobody can remove their own', async () => {
    const { account: actor, token } = await admin();
    const staff = await seedAccount(ds);
    const sub = await signInAndLink(staff, token);
    const ownSub = await signInAndLink(actor, token);
    assert.ok(ownSub);

    const own = await unlinkRoute(req('DELETE', `/accounts/${actor.accountId}/clerk-link`, { token }), ctx(actor.accountId));
    assert.equal(await codeOf(own), 'CANNOT_UNLINK_SELF');

    assert.equal((await unlinkRoute(req('DELETE', `/accounts/${staff.accountId}/clerk-link`, { token }), ctx(staff.accountId))).status, 204);
    assert.equal(await codeOf(await exchange(await clerkToken({ sub }))), 'CCMS_ACCESS_PENDING');
    assert.equal(await codeOf(await unlinkRoute(req('DELETE', `/accounts/${staff.accountId}/clerk-link`, { token }), ctx(staff.accountId))), 'CLERK_LINK_NOT_FOUND');
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_UNLINKED')).find((e) => e.entity_id === staff.accountId);
    assert.deepEqual(event.before_value, { account_id: staff.accountId, clerk_user_id: sub });
  });

  it('lists bound accounts and lets the Super Admin dismiss a pending sign-in', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds);
    await signInAndLink(staff, token);
    const links = await (await linksRoute(req('GET', '/clerk-access/links', { token }))).json();
    assert.deepEqual(links.items.map((l) => l.account_id), [staff.accountId]);

    const sub = newSubject();
    await exchange(await clerkToken({ sub }));
    assert.equal((await dismissRoute(req('DELETE', `/clerk-access/requests/${sub}`, { token }), ctx(sub))).status, 204);
    assert.equal((await dismissRoute(req('DELETE', `/clerk-access/requests/${sub}`, { token }), ctx(sub))).status, 404);
  });

  it('only the Super Admin can see or change bindings', async () => {
    const staff = await seedAccount(ds);
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const token = await tokenFor(await seedAccount(ds, { role }));
      assert.equal((await requestsRoute(req('GET', '/clerk-access/requests', { token }))).status, 403);
      assert.equal((await linksRoute(req('GET', '/clerk-access/links', { token }))).status, 403);
      assert.equal((await linkRoute(req('PUT', `/accounts/${staff.accountId}/clerk-link`, { token, body: { clerk_user_id: 'user_x1' } }), ctx(staff.accountId))).status, 403);
      assert.equal((await unlinkRoute(req('DELETE', `/accounts/${staff.accountId}/clerk-link`, { token }), ctx(staff.accountId))).status, 403);
    }
    assert.equal((await requestsRoute(req('GET', '/clerk-access/requests'))).status, 401);
  });

  it('while Clerk is on, an account can be created without a password; it can never use the password sign-in', async () => {
    setLoginLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
    try {
      const { token } = await admin();
      const body = { employee_no: 'CLK-001', full_name: 'Clerk Only', email: 'clerk.only@example.test', role: ROLES.EXECUTIVE };
      const created = await createRoute(req('POST', '/accounts', { token, body }));
      assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
      const { account } = await created.json();
      const [row] = await ds.query('SELECT password_hash FROM accounts WHERE account_id = $1', [account.account_id]);
      assert.equal(row.password_hash, NO_PASSWORD_MARKER);
      for (const password of ['', 'clerk', 'clerk$', NO_PASSWORD_MARKER, 'Password123!']) {
        const login = await loginRoute(req('POST', '/auth/login', { body: { email: 'clerk.only@example.test', password } }));
        assert.equal(login.status, 401, `password ${JSON.stringify(password)}`);
      }
      // The person gets in through Clerk once the Super Admin binds them.
      const staff = { accountId: account.account_id };
      const sub = await signInAndLink(staff, token);
      assert.equal((await exchange(await clerkToken({ sub }))).status, 200);
      // A password that is given is still checked and stored as before.
      const weak = await createRoute(req('POST', '/accounts', { token, body: { ...body, employee_no: 'CLK-002', email: 'weak@example.test', password: 'short' } }));
      assert.equal(weak.status, 400);
    } finally {
      setLoginLimiter(null);
    }
  });

  it('while Clerk is off, a password is still required to create an account', async () => {
    const { token } = await admin();
    process.env.CLERK_AUTH_ENABLED = 'false';
    const res = await createRoute(req('POST', '/accounts', { token, body: { employee_no: 'CLK-003', full_name: 'No Clerk', email: 'no.clerk@example.test', role: ROLES.EXECUTIVE } }));
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.details.password);
  });

  it('a Clerk token is never accepted where a CCMS token is required', async () => {
    const clerk = await clerkToken();
    assert.equal((await meRoute(req('GET', '/me', { token: clerk }))).status, 401);
  });
});
