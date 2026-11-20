import { strict as assert } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { POST as loginRoute, setLoginLimiter } from '../src/app/api/auth/login/route.js';
import { POST as refreshRoute } from '../src/app/api/auth/refresh/route.js';
import { cutoverAccount, inventoryAccounts } from '../src/lib/clerk-cutover.js';
import { OFFICE_A, PASSWORD, outboxEvents, refreshTokenFrom, req, seedAccount, setupTestEnv } from './helpers.js';

// S8-29 / S8-30 (D8-02 Clerk only): read-only inventory and the per-account cutover (dry run by default).
let env; let ds; let n = 0;
before(async () => { env = await setupTestEnv(); ds = env.ds; });
after(() => env?.cleanup());
afterEach(async () => { setLoginLimiter(null); await ds.query('DELETE FROM account_clerk_links'); });

const login = (email, password = PASSWORD) => loginRoute(req('POST', '/auth/login', { body: { email, password } }));
const link = (account, by) => ds.query(`INSERT INTO account_clerk_links (account_id, clerk_issuer, clerk_user_id, linked_by) VALUES ($1, 'https://x.clerk.accounts.dev', $2, $3)`, [account.accountId, `user_c${(n += 1)}`, by.accountId]);
const staff = (email) => seedAccount(ds, { role: ROLES.OFFICE_STAFF, email, officeId: OFFICE_A });
const asActor = (a) => ({ id: a.accountId, role: ROLES.SUPER_ADMIN });

describe('S8-29 inventory', () => {
  it('lists every account with how it signs in and a next step, with no email or name', async () => {
    setLoginLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const a = await staff('inv.password@example.test');
    const b = await staff('inv.both@example.test');
    await link(b, admin);
    const list = await inventoryAccounts(ds);
    const find = (acc) => list.find((r) => r.account_id === acc.accountId);
    assert.equal(find(a).sign_in, 'password_only');
    assert.match(find(a).next_step, /link/i);
    assert.equal(find(b).sign_in, 'clerk_and_password');
    assert.equal(find(b).next_step, 'ready for cutover');
    assert.equal(find(a).email_domain, 'example.test');
    assert.equal(find(a).reserved_test_domain, true);
    assert.ok(list.every((r) => !('email' in r) && !('full_name' in r)));
    assert.match(find(a).provenance, /PM TO DECIDE/);
  });
});

describe('S8-30 cutover', () => {
  it('dry run changes nothing and says what it would do', async () => {
    setLoginLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const a = await staff('dry.run@example.test');
    await link(a, admin);
    assert.equal((await login('dry.run@example.test')).status, 200);
    const plan = await cutoverAccount(ds, a.accountId, { actor: asActor(admin) });
    assert.deepEqual([plan.applied, plan.had_password, plan.refresh_tokens_to_revoke], [false, true, 1]);
    assert.equal((await login('dry.run@example.test')).status, 200, 'the password still works after a dry run');
  });

  it('apply: the old password is refused, the old refresh cookie stops renewing, the audit entry exists, and the account row is otherwise unchanged', async () => {
    setLoginLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const a = await staff('cut.over@example.test');
    await link(a, admin);
    const first = await login('cut.over@example.test');
    const cookie = refreshTokenFrom(first);
    const result = await cutoverAccount(ds, a.accountId, { actor: asActor(admin), apply: true });
    assert.equal(result.applied, true);
    assert.equal((await login('cut.over@example.test')).status, 401, 'the old shared password no longer works');
    assert.equal((await refreshRoute(req('POST', '/auth/refresh', { cookie: `ccms_refresh=${cookie}` }))).status, 401, 'the old session cannot renew');
    const row = (await ds.query('SELECT account_id, role_key, office_id, is_active FROM accounts WHERE account_id = $1', [a.accountId]))[0];
    assert.deepEqual([row.account_id, row.role_key, row.office_id, row.is_active], [a.accountId, ROLES.OFFICE_STAFF, OFFICE_A, true]);
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM account_clerk_links WHERE account_id = $1', [a.accountId]))[0].n, 1, 'the Clerk link stays');
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_CUTOVER')).find((e) => e.entity_id === a.accountId);
    assert.equal(event.before_value.had_password, true);
    assert.equal(event.actor_user_id, admin.accountId);
  });

  it('running it again is harmless', async () => {
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const a = await staff('twice@example.test');
    await link(a, admin);
    await cutoverAccount(ds, a.accountId, { actor: asActor(admin), apply: true });
    const again = await cutoverAccount(ds, a.accountId, { actor: asActor(admin), apply: true });
    assert.equal(again.had_password, false);
    assert.equal(again.refresh_tokens_to_revoke, 0);
  });

  it('refuses an account that is not linked to Clerk, a deactivated account, an unknown account and a bad ID', async () => {
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const unlinked = await staff('unlinked@example.test');
    await assert.rejects(() => cutoverAccount(ds, unlinked.accountId, { actor: asActor(admin), apply: true }), (e) => e.code === 'NOT_LINKED');
    const off = await staff('off@example.test');
    await link(off, admin);
    await ds.query('UPDATE accounts SET is_active = false WHERE account_id = $1', [off.accountId]);
    await assert.rejects(() => cutoverAccount(ds, off.accountId, { actor: asActor(admin), apply: true }), (e) => e.code === 'ACCOUNT_INACTIVE');
    await assert.rejects(() => cutoverAccount(ds, '00000000-0000-4000-8000-000000000000', { actor: asActor(admin) }), (e) => e.status === 404);
    await assert.rejects(() => cutoverAccount(ds, 'nope', { actor: asActor(admin) }), (e) => e.status === 400);
    const pw = (await ds.query('SELECT password_hash FROM accounts WHERE account_id = $1', [unlinked.accountId]))[0].password_hash;
    assert.notEqual(pw, 'clerk$', 'a refused cutover changes nothing');
  });

  it('a Super Admin is cut over only while at least two active Super Admins are linked to Clerk', async () => {
    await ds.query("UPDATE accounts SET is_active = false WHERE role_key = 'super_admin'");
    const one = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    await link(one, one);
    await assert.rejects(() => cutoverAccount(ds, one.accountId, { actor: asActor(one), apply: true }), (e) => e.code === 'TWO_SUPER_ADMINS_REQUIRED');
    const two = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    await link(two, one);
    assert.equal((await cutoverAccount(ds, one.accountId, { actor: asActor(two), apply: true })).applied, true);
  });

  it('apply without an actor is refused', async () => {
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const a = await staff('noactor@example.test');
    await link(a, admin);
    await assert.rejects(() => cutoverAccount(ds, a.accountId, { apply: true }), (e) => e.status === 400);
  });
});
