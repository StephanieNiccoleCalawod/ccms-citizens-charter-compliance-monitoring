import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { GET, PATCH } from '../src/app/api/offices/[id]/route.js';
import { OFFICE_A, OFFICE_B, ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';
import { S853OfficeBackdatePermission1795478500000 } from '../migrations/1795478500000-S853OfficeBackdatePermission.js';

let env;
before(async () => {
  env = await setupTestEnv();
  for (const [id, code] of [[OFFICE_A, 'A'], [OFFICE_B, 'B']]) {
    await env.ds.query('INSERT INTO offices (office_id,office_code,office_name) VALUES ($1,$2,$2)', [id, code]);
  }
});
after(async () => env?.teardown());
test('S8-53 migration backfills existing offices off and defaults new offices off', async () => {
  const runner = env.ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    // Temporary table shadows the real office table only on this connection.
    await runner.query('CREATE TEMP TABLE offices (office_id uuid PRIMARY KEY) ON COMMIT DROP');
    await runner.query('INSERT INTO offices (office_id) VALUES ($1)', [OFFICE_A]);
    await new S853OfficeBackdatePermission1795478500000().up(runner);
    await runner.query('INSERT INTO offices (office_id) VALUES ($1)', [OFFICE_B]);
    const rows = await runner.query('SELECT allow_backdated_transactions FROM offices');
    assert.deepEqual(rows.map((r) => r.allow_backdated_transactions), [false, false]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});
test('S8-53 HTTP roles, per-office default, persistence, and atomic audit outbox', async () => {
  const patch = (allowed, token = tokens.superAdmin) => PATCH(req('PATCH', `/offices/${OFFICE_A}`, {
    token, body: { allow_backdated_transactions: allowed },
  }), ctx(OFFICE_A));
  const initial = await GET(req('GET', `/offices/${OFFICE_A}`, { token: tokens.superAdmin }), ctx(OFFICE_A));
  assert.equal((await initial.json()).office.allow_backdated_transactions, false);
  assert.equal((await patch(true, tokens.officeHeadA)).status, 403);
  assert.equal((await patch(true, tokens.officeStaffA)).status, 403);
  assert.equal((await patch(true, tokens.executive)).status, 403);
  assert.equal((await patch(true)).status, 200);
  assert.equal((await patch(true)).status, 200);
  const [other] = await env.ds.query('SELECT allow_backdated_transactions FROM offices WHERE office_id=$1', [OFFICE_B]);
  assert.equal(other.allow_backdated_transactions, false);
  const events = () => env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action'='OFFICE_BACKDATE_PERMISSION_CHANGED' ORDER BY created_at");
  assert.equal((await events()).length, 1);
  assert.equal((await patch(false)).status, 200);
  const audit = await events();
  assert.equal(audit.length, 2);
  assert.equal(audit[0].payload.before_value.allow_backdated_transactions, false);
  assert.equal(audit[0].payload.after_value.allow_backdated_transactions, true);
  assert.equal(audit[1].payload.after_value.allow_backdated_transactions, false);
});
