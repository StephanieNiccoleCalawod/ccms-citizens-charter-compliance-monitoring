// CC050 regression (with CC027 / K14): the completion outcome through the route, and the disapproval reason kept out of the
// audit log, the TT2 analytics feed and export, and every Executive response. Synthetic data; real PostgreSQL (TEST_PG_URL).
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as detailRoute } from '../src/app/api/transactions/[id]/route.js';
import { POST as cancelRoute } from '../src/app/api/transactions/[id]/cancel/route.js';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { GET as listRoute } from '../src/app/api/transactions/route.js';
import { exportAnalyticsPage } from '../src/modules/analytics/export.js';
import { OFFICE_A, SERVICE_B, USERS, at, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

const REASON = 'SYNTH-CC050-REASON-Z9 (client name and details)';

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

// A one-hour standard, started 10:00 Manila; Core's working-minutes stub decides on time or late.
const open = () => insertTransaction(env.ds, { started_by: USERS.staffA, service_id: SERVICE_B, office_id: OFFICE_A, standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, started_at: new Date(at('2026-10-06', '10:00')) });
const complete = (id, body, token = tokens.officeStaffA) => call(completeRoute, req('POST', `/transactions/${id}/complete`, { token, body }), ctx(id));
const detail = (id, token) => call(detailRoute, req('GET', `/transactions/${id}`, { token }), ctx(id));
const stateOf = async (id) => (await env.ds.query('SELECT status, outcome, disapproval_reason, disapproval_notice_given FROM transactions WHERE transaction_id = $1', [id]))[0];

describe('CC050 through the complete route', () => {
  it('Granted needs neither a reason nor the tick', async () => {
    const t = await open();
    const r = await complete(t.transaction_id, { outcome: 'GRANTED' });
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, 'GRANTED');
    assert.deepEqual(await stateOf(t.transaction_id), { status: 'COMPLETED', outcome: 'GRANTED', disapproval_reason: null, disapproval_notice_given: null });
  });

  it('Disapproved: each missing or invalid field is named in a 400 and nothing is saved', async () => {
    const t = await open();
    const cases = [
      [{ outcome: 'DISAPPROVED', disapproval_notice_given: true }, 'disapproval_reason'],
      [{ outcome: 'DISAPPROVED', disapproval_reason: '   ', disapproval_notice_given: true }, 'disapproval_reason'],
      [{ outcome: 'DISAPPROVED', disapproval_reason: 'x'.repeat(1001), disapproval_notice_given: true }, 'disapproval_reason'],
      [{ outcome: 'DISAPPROVED', disapproval_reason: REASON }, 'disapproval_notice_given'],
      [{ outcome: 'DISAPPROVED', disapproval_reason: REASON, disapproval_notice_given: false }, 'disapproval_notice_given'],
      [{ outcome: 'MAYBE' }, 'outcome'],
    ];
    for (const [body, field] of cases) {
      const r = await complete(t.transaction_id, body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.ok(r.body.error.details[field], field);
    }
    assert.equal((await stateOf(t.transaction_id)).status, 'IN_PROGRESS');
  });

  it('a reason of exactly 1,000 characters (after trimming) is accepted', async () => {
    const t = await open();
    const r = await complete(t.transaction_id, { outcome: 'DISAPPROVED', disapproval_reason: `  ${'y'.repeat(1000)}  `, disapproval_notice_given: true });
    assert.equal(r.status, 200);
    assert.equal((await stateOf(t.transaction_id)).disapproval_reason.length, 1000);
  });

  it('an older caller that omits the outcome still completes, and the outcome stays null ("Not recorded")', async () => {
    const t = await open();
    const r = await complete(t.transaction_id, undefined);
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, null);
  });

  it('Cancel stays a separate action: it never records an outcome', async () => {
    const t = await open();
    const r = await call(cancelRoute, req('POST', `/transactions/${t.transaction_id}/cancel`, { token: tokens.officeHeadA, body: { reason: 'Client left', outcome: 'GRANTED' } }), ctx(t.transaction_id));
    assert.equal(r.status, 200);
    assert.deepEqual(await stateOf(t.transaction_id), { status: 'CANCELLED', outcome: null, disapproval_reason: null, disapproval_notice_given: null });
  });
});

describe('CC050 privacy at the source: the disapproval reason stays in the transaction row only', () => {
  it('audit has the outcome, not the reason; TT2 events and the export have the outcome, not the reason; the Executive gets neither', async () => {
    const t = await open();
    const done = await complete(t.transaction_id, { outcome: 'DISAPPROVED', disapproval_reason: REASON, disapproval_notice_given: true });
    assert.equal(done.status, 200);
    assert.equal(done.body.disapproval_reason, REASON, 'the person who completed it sees their own record');

    const audit = await env.ds.query('SELECT payload FROM audit_outbox');
    assert.ok(audit.length > 0);
    assert.ok(!JSON.stringify(audit).includes('SYNTH-CC050-REASON-Z9'), 'audit');
    const completed = audit.find((a) => a.payload.action === 'TRANSACTION_COMPLETED');
    assert.equal(completed.payload.after_value.outcome, 'DISAPPROVED');

    const events = await env.ds.query('SELECT payload FROM analytics_outbox WHERE transaction_id = $1', [t.transaction_id]);
    assert.ok(events.length > 0);
    assert.ok(!JSON.stringify(events).includes('SYNTH-CC050-REASON-Z9'), 'TT2 events');
    assert.ok(events.some((e) => e.payload.snapshot?.outcome === 'DISAPPROVED'), 'the snapshot carries the outcome');
    for (const e of events) assert.ok(!('disapproval_reason' in (e.payload.snapshot ?? {})) && !('disapproval_notice_given' in (e.payload.snapshot ?? {})));

    const page = await exportAnalyticsPage(env.ds, { limit: 50 });
    const exported = page.items.find((i) => i.transaction_id === t.transaction_id);
    assert.equal(exported.outcome, 'DISAPPROVED');
    assert.ok(!JSON.stringify(page).includes('SYNTH-CC050-REASON-Z9'), 'TT2 export');

    const exec = await detail(t.transaction_id, tokens.executive);
    assert.equal(exec.status, 200);
    assert.equal(exec.body.outcome, 'DISAPPROVED');
    assert.ok(!('disapproval_reason' in exec.body) && !('disapproval_notice_given' in exec.body));
    const execList = await call(listRoute, req('GET', '/transactions', { token: tokens.executive }));
    assert.ok(!JSON.stringify(execList.body).includes('SYNTH-CC050-REASON-Z9'), 'Executive list');
    assert.ok(!JSON.stringify(exec.body).includes('SYNTH-CC050-REASON-Z9'), 'Executive detail');
  });

  it('both outcomes get the same compliance result for the same times', async () => {
    const results = [];
    for (const body of [{ outcome: 'GRANTED' }, { outcome: 'DISAPPROVED', disapproval_reason: REASON, disapproval_notice_given: true }]) {
      const t = await open();
      const r = await complete(t.transaction_id, { ...body, ended_at: '2026-10-06T11:30:00+08:00', backdate_reason: 'Recorded after the fact' });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
      results.push([r.body.elapsed_working_minutes, r.body.is_compliant, r.body.variance_minutes]);
      await resetData(env.ds);
    }
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0][1], false, '90 working minutes against a one-hour standard is late for either decision');
  });
});
