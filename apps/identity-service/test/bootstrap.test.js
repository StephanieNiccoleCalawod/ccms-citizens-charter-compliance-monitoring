import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { POST as loginRoute } from '../src/app/api/auth/login/route.js';
import { bootstrapSuperAdmin } from '../src/lib/bootstrap.js';
import { req, seedAccount, setupTestEnv } from './helpers.js';

let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());

const options = { email: 'First.Admin@pup.edu.ph', password: 'Bootstrap-Pass-1', employeeNo: 'ADMIN-001', fullName: 'First Admin' };
const count = async () => Number((await ds.query(`SELECT count(*)::int AS n FROM accounts WHERE role_key = 'super_admin' AND is_active`))[0].n);

describe('TT8 first Super Admin bootstrap', () => {
  it('AC1: with no Super Admin, it creates one active Super Admin who can sign in', async () => {
    assert.equal(await count(), 0);
    const result = await bootstrapSuperAdmin(ds, options);
    assert.equal(result.created, true);
    assert.equal(await count(), 1);
    const response = await loginRoute(req('POST', '/auth/login', { body: { email: 'first.admin@pup.edu.ph', password: options.password } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, ROLES.SUPER_ADMIN);
    const [event] = await ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = 'ACCOUNT_CREATED'`);
    assert.equal(event.payload.after_value.email, 'first.admin@pup.edu.ph');
    assert.ok(!JSON.stringify(event.payload).includes('scrypt'));
  });

  it('AC2: running it again changes nothing', async () => {
    const before = await ds.query('SELECT account_id, updated_at FROM accounts ORDER BY account_id');
    const again = await bootstrapSuperAdmin(ds, { ...options, email: 'someone.else@pup.edu.ph', password: 'Different-Pass-2' });
    assert.equal(again.created, false);
    const after = await ds.query('SELECT account_id, updated_at FROM accounts ORDER BY account_id');
    assert.deepEqual(after, before);
    assert.equal(await count(), 1);
  });

  it('does nothing when any Super Admin exists, even if deactivated, and rejects a weak password', async () => {
    await ds.query('DELETE FROM accounts');
    await seedAccount(ds, { role: ROLES.SUPER_ADMIN, active: false });
    assert.equal((await bootstrapSuperAdmin(ds, options)).created, false);
    await ds.query('DELETE FROM accounts');
    await assert.rejects(bootstrapSuperAdmin(ds, { ...options, password: 'short' }), /valid BOOTSTRAP_ADMIN_PASSWORD/);
    await assert.rejects(bootstrapSuperAdmin(ds, { ...options, email: '' }), /BOOTSTRAP_ADMIN_EMAIL/);
  });

  it('concurrent runs still create exactly one Super Admin', async () => {
    await ds.query('DELETE FROM accounts');
    const results = await Promise.all([bootstrapSuperAdmin(ds, options), bootstrapSuperAdmin(ds, options), bootstrapSuperAdmin(ds, options)]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(await count(), 1);
  });
});
