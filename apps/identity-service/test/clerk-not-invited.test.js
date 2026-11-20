import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { ROLES } from 'ccms-shared';
import { PUT as linkRoute } from '../src/app/api/accounts/[id]/clerk-link/route.js';
import { POST as exchangeRoute, setExchangeLimiter } from '../src/app/api/auth/clerk/exchange/route.js';
import { isKnownToCccms } from '../src/lib/clerk-access.js';
import { ctx, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

// S8-45: with CLERK_REQUIRE_INVITATION on, only people CCCMS knows get past the sign-in page. Off (the default) changes nothing.
const ISSUER = 'https://example-instance-0000.clerk.accounts.dev';
const ORIGIN = 'http://localhost:3000';
let env;
let ds;
let key;

before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  key = await generateKeyPair('RS256', { extractable: true });
});
after(() => env?.cleanup());
beforeEach(async () => {
  process.env.CLERK_AUTH_ENABLED = 'true';
  process.env.CLERK_ISSUER = ISSUER;
  process.env.CLERK_JWT_KEY = (await exportSPKI(key.publicKey)).replace(/\n/g, '\\n');
  process.env.CLERK_AUTHORIZED_PARTIES = ORIGIN;
  setExchangeLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
});
afterEach(async () => {
  for (const name of ['CLERK_AUTH_ENABLED', 'CLERK_ISSUER', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_REQUIRE_INVITATION']) delete process.env[name];
  setExchangeLimiter(null);
  await ds.query('DELETE FROM account_clerk_links');
  await ds.query('DELETE FROM clerk_access_requests');
});

let seq = 0;
const newSubject = () => `user_ni${Date.now()}${(seq += 1)}`;
async function clerkToken({ sub = newSubject(), email = 'person@example.test' } = {}) {
  return new SignJWT({ azp: ORIGIN, sid: 'sess_test123', v: 2, email })
    .setProtectedHeader({ alg: 'RS256', kid: 'ins_test' }).setIssuer(ISSUER).setIssuedAt().setExpirationTime('60s').setSubject(sub).sign(key.privateKey);
}
const exchange = (token) => exchangeRoute(req('POST', '/auth/clerk/exchange', { token }));
const codeOf = async (response) => (await response.json()).error?.code;
const requestRows = (sub) => ds.query('SELECT 1 FROM clerk_access_requests WHERE clerk_user_id = $1', [sub]);

describe('S8-45 uninvited Clerk users', () => {
  it('switch off (default): an unknown person is still recorded as pending, as before', async () => {
    const sub = newSubject();
    const res = await exchange(await clerkToken({ sub }));
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), 'CCMS_ACCESS_PENDING');
    assert.equal((await requestRows(sub)).length, 1);
  });

  it('switch on: an unknown person is refused NOT_INVITED, gets no token and no access request is stored', async () => {
    process.env.CLERK_REQUIRE_INVITATION = 'true';
    const sub = newSubject();
    const res = await exchange(await clerkToken({ sub, email: 'someone@fms.example.test' }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_INVITED');
    assert.equal(body.access_token, undefined);
    assert.equal((await requestRows(sub)).length, 0);
  });

  it('switch on: a person whose email matches an active, unbound CCCMS account is still recorded as pending', async () => {
    process.env.CLERK_REQUIRE_INVITATION = 'true';
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, email: 'Registered.Person@example.test' });
    const sub = newSubject();
    const res = await exchange(await clerkToken({ sub, email: 'registered.person@example.test' }));
    assert.equal(await codeOf(res), 'CCMS_ACCESS_PENDING');
    assert.equal((await requestRows(sub)).length, 1);
    assert.ok(account.accountId);
  });

  it('switch on: an inactive account does not make a person known', async () => {
    process.env.CLERK_REQUIRE_INVITATION = 'true';
    await seedAccount(ds, { role: ROLES.OFFICE_STAFF, email: 'inactive.person@example.test', active: false });
    const sub = newSubject();
    assert.equal(await codeOf(await exchange(await clerkToken({ sub, email: 'inactive.person@example.test' }))), 'NOT_INVITED');
    assert.equal((await requestRows(sub)).length, 0);
  });

  it('switch on: a request recorded before the switch stays pending', async () => {
    const sub = newSubject();
    await exchange(await clerkToken({ sub, email: 'early@example.test' }));
    process.env.CLERK_REQUIRE_INVITATION = 'true';
    assert.equal(await codeOf(await exchange(await clerkToken({ sub, email: 'early@example.test' }))), 'CCMS_ACCESS_PENDING');
  });

  it('switch on: a linked, active person signs in as before; a deactivated one gets ACCOUNT_INACTIVE, not NOT_INVITED', async () => {
    const adminAccount = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const adminToken = await tokenFor(adminAccount);
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, email: 'linked.person@example.test' });
    const sub = newSubject();
    await exchange(await clerkToken({ sub, email: 'linked.person@example.test' })); // pending, switch still off
    const linked = await linkRoute(req('PUT', `/accounts/${account.accountId}/clerk-link`, { token: adminToken, body: { clerk_user_id: sub } }), ctx(account.accountId));
    assert.equal(linked.status, 200);

    process.env.CLERK_REQUIRE_INVITATION = 'true';
    const ok = await exchange(await clerkToken({ sub, email: 'linked.person@example.test' }));
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).access_token);

    await ds.query('UPDATE accounts SET is_active = false WHERE account_id = $1', [account.accountId]);
    assert.equal(await codeOf(await exchange(await clerkToken({ sub, email: 'linked.person@example.test' }))), 'ACCOUNT_INACTIVE');
  });

  it('fails closed: if the lookup breaks, nobody is let in', async () => {
    const broken = { query: async () => { throw new Error('database unavailable'); } };
    await assert.rejects(() => isKnownToCccms(broken, { issuer: ISSUER, subject: 'user_x', email: 'a@b.test' }), /database unavailable/);
  });

  it('a person without an email is not known unless they already have a request', async () => {
    assert.equal(await isKnownToCccms(ds, { issuer: ISSUER, subject: 'user_noemail', email: null }), false);
  });
});
