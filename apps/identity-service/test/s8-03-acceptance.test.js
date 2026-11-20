// S8-03 acceptance gaps (BE side): password sign-in keeps working through Clerk linking and unlinking (the rollback path), and a Pending
// person gets nothing but a refusal. The other Pending, approve, deactivate and unlink cases are already in clerk.test.js.
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { ROLES } from 'ccms-shared';
import { DELETE as unlinkRoute, PUT as linkRoute } from '../src/app/api/accounts/[id]/clerk-link/route.js';
import { POST as loginRoute, setLoginLimiter } from '../src/app/api/auth/login/route.js';
import { POST as exchangeRoute, setExchangeLimiter } from '../src/app/api/auth/clerk/exchange/route.js';
import { PASSWORD, ctx, req, seedAccount, setupTestEnv, tokenFor, OFFICE_A } from './helpers.js';

const ISSUER = 'https://example-instance-0000.clerk.accounts.dev';
const ORIGIN = 'http://localhost:3000';
let env; let ds; let key; let n = 0;

before(async () => { env = await setupTestEnv(); ds = env.ds; key = await generateKeyPair('RS256', { extractable: true }); });
after(() => env?.cleanup());
beforeEach(async () => {
  Object.assign(process.env, { CLERK_AUTH_ENABLED: 'true', CLERK_ISSUER: ISSUER, CLERK_AUTHORIZED_PARTIES: ORIGIN });
  process.env.CLERK_JWT_KEY = (await exportSPKI(key.publicKey)).replace(/\n/g, '\\n');
  setExchangeLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
  setLoginLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
});
afterEach(async () => {
  for (const name of ['CLERK_AUTH_ENABLED', 'CLERK_ISSUER', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES']) delete process.env[name];
  setExchangeLimiter(null); setLoginLimiter(null);
  await ds.query('DELETE FROM account_clerk_links'); await ds.query('DELETE FROM clerk_access_requests');
});

const clerkToken = (sub, email) => new SignJWT({ azp: ORIGIN, sid: 'sess_x', v: 2, email }).setProtectedHeader({ alg: 'RS256', kid: 'ins_test' }).setIssuer(ISSUER).setIssuedAt().setExpirationTime('60s').setSubject(sub).sign(key.privateKey);
const exchange = (token) => exchangeRoute(req('POST', '/auth/clerk/exchange', { token }));
const login = (email) => loginRoute(req('POST', '/auth/login', { body: { email, password: PASSWORD } }));

describe('S8-03 sign-in access', () => {
  it('a Pending person gets a 403 with no token and no cookie, and cannot choose a role', async () => {
    const res = await exchange(await clerkToken(`user_pending${(n += 1)}`, 'nobody@example.test'));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('set-cookie'), null);
    const text = JSON.stringify(await res.json());
    assert.doesNotMatch(text, /access_token|refresh_token/);
  });

  it('password sign-in keeps working while Clerk is on, after linking, and after unlinking (rollback)', async () => {
    const adminAccount = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const adminToken = await tokenFor(adminAccount);
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, email: 'rollback.staff@example.test' });
    assert.equal((await login('rollback.staff@example.test')).status, 200, 'before linking');

    const sub = `user_roll${(n += 1)}`;
    assert.equal((await exchange(await clerkToken(sub, 'rollback.staff@example.test'))).status, 403); // becomes a pending request
    const link = await linkRoute(req('PUT', `/accounts/${staff.accountId}/clerk-link`, { token: adminToken, body: { clerk_user_id: sub } }), ctx(staff.accountId));
    assert.equal(link.status, 200);
    assert.equal((await exchange(await clerkToken(sub, 'rollback.staff@example.test'))).status, 200, 'Clerk works once linked');
    assert.equal((await login('rollback.staff@example.test')).status, 200, 'password still works while linked (dual mode)');

    const unlink = await unlinkRoute(req('DELETE', `/accounts/${staff.accountId}/clerk-link`, { token: adminToken }), ctx(staff.accountId));
    assert.equal(unlink.status, 204);
    assert.equal((await exchange(await clerkToken(sub, 'rollback.staff@example.test'))).status, 403, 'unlinked: Clerk is refused again');
    assert.equal((await login('rollback.staff@example.test')).status, 200, 'rollback: password sign-in still works');
  });

  it('a deactivated account is refused on both sign-in paths', async () => {
    const adminAccount = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const adminToken = await tokenFor(adminAccount);
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, email: 'inactive.staff@example.test' });
    const sub = `user_off${(n += 1)}`;
    await exchange(await clerkToken(sub, 'inactive.staff@example.test'));
    await linkRoute(req('PUT', `/accounts/${staff.accountId}/clerk-link`, { token: adminToken, body: { clerk_user_id: sub } }), ctx(staff.accountId));
    await ds.query('UPDATE accounts SET is_active = false WHERE account_id = $1', [staff.accountId]);
    const viaClerk = await exchange(await clerkToken(sub, 'inactive.staff@example.test'));
    assert.equal(viaClerk.status, 403);
    assert.equal((await viaClerk.json()).error.code, 'ACCOUNT_INACTIVE');
    assert.notEqual((await login('inactive.staff@example.test')).status, 200);
  });
});
