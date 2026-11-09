// CC050: complete as Granted or Disapproved with a reason.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestDatabase } from 'ccms-shared/testing';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { migrateSprint5Operations } from '../src/lib/migrations/sprint5.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { completeTransaction } from '../src/modules/transaction/complete.js';
import { OFFICE_A, SERVICE_B, USERS, at, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, staff, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const hourly = { service_id: SERVICE_B, office_id: OFFICE_A, standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0 };
const open = () => insertTransaction(env.ds, { started_by: USERS.staffA, ...hourly, started_at: new Date(at('2026-10-06', '10:00')) });
const deps = (nowIso) => ({ core: createCoreClient(), now: () => new Date(nowIso) });
const finish = (id, body, nowIso = '2026-10-06T10:45:00+08:00') => completeTransaction(env.ds, deps(nowIso), staff(USERS.staffA), id, body);
const stateOf = async (id) => (await env.ds.query('SELECT * FROM transactions WHERE transaction_id = $1', [id]))[0];
const auditOf = (action) => env.ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = $1`, [action]);
const disapproved = (over = {}) => ({ outcome: 'DISAPPROVED', disapproval_reason: 'Missing signature on the form', disapproval_notice_given: true, ...over });

describe('CC050 outcome', () => {
  it('AC1: Disapproved without a reason is refused naming the field', async () => {
    const t = await open();
    for (const bad of [{ disapproval_reason: undefined }, { disapproval_reason: '   ' }, { disapproval_reason: 'x'.repeat(1001) }]) {
      await assert.rejects(finish(t.transaction_id, disapproved(bad)), (e) => e.status === 400 && 'disapproval_reason' in (e.details ?? e.fields ?? {}));
    }
    assert.equal((await stateOf(t.transaction_id)).status, 'IN_PROGRESS', 'nothing was saved');
  });

  it('AC1: Disapproved without the written-notice tick is refused naming the field', async () => {
    const t = await open();
    for (const bad of [undefined, false, 'true', 1]) {
      await assert.rejects(finish(t.transaction_id, disapproved({ disapproval_notice_given: bad })), (e) => e.status === 400 && 'disapproval_notice_given' in (e.details ?? e.fields ?? {}));
    }
    assert.equal((await stateOf(t.transaction_id)).status, 'IN_PROGRESS');
  });

  it('an unknown outcome is refused', async () => {
    const t = await open();
    for (const bad of ['APPROVED', 'granted', 5, {}]) {
      await assert.rejects(finish(t.transaction_id, { outcome: bad }), (e) => e.status === 400 && 'outcome' in (e.details ?? e.fields ?? {}));
    }
  });

  it('AC2: Granted needs neither a reason nor the tick, and stores none even if sent', async () => {
    const t = await open();
    const done = await finish(t.transaction_id, { outcome: 'GRANTED', disapproval_reason: 'ignored', disapproval_notice_given: true });
    assert.equal(done.outcome, 'GRANTED');
    assert.equal(done.disapproval_reason, null);
    assert.equal(done.disapproval_notice_given, null);
  });

  it('AC3: both outcomes get the same on-time or late result', async () => {
    const a = await open();
    const granted = await finish(a.transaction_id, { outcome: 'GRANTED' }, '2026-10-06T11:30:00+08:00');
    await resetData(env.ds);
    const b = await open();
    const refused = await finish(b.transaction_id, disapproved(), '2026-10-06T11:30:00+08:00');
    for (const r of [granted, refused]) assert.deepEqual([r.elapsed_working_minutes, r.is_compliant, r.variance_minutes], [90, false, 30]);
    assert.equal(refused.outcome, 'DISAPPROVED');
    assert.equal(refused.disapproval_reason, 'Missing signature on the form');
    assert.equal(refused.disapproval_notice_given, true);
  });

  it('the reason is trimmed, and the list leaves the reason out while the detail has it', async () => {
    const t = await open();
    await finish(t.transaction_id, disapproved({ disapproval_reason: '  Incomplete  ' }));
    assert.equal((await stateOf(t.transaction_id)).disapproval_reason, 'Incomplete');
    const { toTransactionDto } = await import('../src/modules/transaction/dto.js');
    const row = await stateOf(t.transaction_id);
    assert.equal(toTransactionDto(row, { detail: false }).outcome, 'DISAPPROVED');
    assert.equal('disapproval_reason' in toTransactionDto(row, { detail: false }), false);
    assert.equal(toTransactionDto(row).disapproval_reason, 'Incomplete');
  });

  it('the audit entry has the outcome but never the reason text', async () => {
    const t = await open();
    await finish(t.transaction_id, disapproved({ disapproval_reason: 'SECRET-REASON-TEXT' }));
    const all = await env.ds.query('SELECT payload FROM audit_outbox');
    assert.ok(!JSON.stringify(all).includes('SECRET-REASON-TEXT'));
    const [completed] = await auditOf('TRANSACTION_COMPLETED');
    assert.equal(completed.payload.after_value.outcome, 'DISAPPROVED');
  });

  it('AC4: cancel is separate and unchanged', async () => {
    const t = await open();
    const { POST: cancelRoute } = await import('../src/app/api/transactions/[id]/cancel/route.js');
    const res = await call(cancelRoute, req('POST', `/transactions/${t.transaction_id}/cancel`, { token: tokens.officeHeadA, body: { reason: 'Client left', outcome: 'DISAPPROVED' } }), ctx(t.transaction_id));
    assert.equal(res.status, 200);
    assert.equal((await stateOf(t.transaction_id)).outcome, null);
  });

  it('AC5: old rows and rows completed without an outcome show null ("Not recorded")', async () => {
    const t = await open();
    const done = await finish(t.transaction_id, {});
    assert.equal(done.outcome, null);
    assert.equal(done.disapproval_reason, null);
  });

  it('works through the route', async () => {
    const t = await open();
    const res = await call(completeRoute, req('POST', `/transactions/${t.transaction_id}/complete`, { token: tokens.officeStaffA, body: { outcome: 'DISAPPROVED', disapproval_notice_given: true } }), ctx(t.transaction_id));
    assert.equal(res.status, 400);
  });

  it('the database refuses a Disapproved row without reason or tick', async () => {
    const t = await open();
    await assert.rejects(env.ds.query(`UPDATE transactions SET outcome = 'DISAPPROVED' WHERE transaction_id = $1`, [t.transaction_id]), (e) => e.code === '23514');
    await assert.rejects(env.ds.query(`UPDATE transactions SET outcome = 'GRANTED', disapproval_reason = 'x' WHERE transaction_id = $1`, [t.transaction_id]), (e) => e.code === '23514');
    await assert.rejects(env.ds.query(`UPDATE transactions SET outcome = 'MAYBE' WHERE transaction_id = $1`, [t.transaction_id]), (e) => e.code === '23514');
  });
});

describe('CC050 migration', () => {
  it('adds the columns to an old table twice and leaves old rows empty', async () => {
    const database = await createTestDatabase({ entities: [] });
    try {
      const ds = database.dataSource, id = randomUUID();
      await ds.query(`CREATE TABLE transactions (transaction_id uuid PRIMARY KEY, status text)`);
      await ds.query(`INSERT INTO transactions VALUES ($1, 'COMPLETED')`, [id]);
      await migrateSprint5Operations(ds);
      await migrateSprint5Operations(ds);
      assert.deepEqual(await ds.query('SELECT outcome, disapproval_reason, disapproval_notice_given FROM transactions'), [{ outcome: null, disapproval_reason: null, disapproval_notice_given: null }]);
    } finally {
      await database.drop();
    }
  });
});
