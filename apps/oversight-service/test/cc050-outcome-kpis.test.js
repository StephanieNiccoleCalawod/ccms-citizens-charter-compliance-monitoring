// CC050: Granted / Disapproved / Not recorded totals on the existing KPI surface (GET /api/analytics/kpis), under the existing
// office, service and date filters. Pure computeKpis plus getStartKpis with a stand-in data source; no database needed.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ANALYTICS_SNAPSHOT_FIELD_NAMES, ROLES } from 'ccms-shared';
import { computeKpis, getStartKpis } from '../src/modules/analytics/kpi.js';

const OFFICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_1 = '11111111-1111-4111-8111-111111111111';
const SERVICE_2 = '22222222-2222-4222-8222-222222222222';

// Manila is UTC+8: 2026-10-06T00:00Z is 08:00 Manila on 10/06; 2026-10-31T16:30Z is 00:30 Manila on 11/01.
const row = (over = {}) => ({
  office_id: OFFICE_A, service_id: SERVICE_1, started_at: '2026-10-06T00:00:00Z', ended_at: null, status: 'IN_PROGRESS', outcome: null,
  is_backdated: false, started_outside_hours: false, registry_status: 'NONE', registry_miss_reason: null, ...over,
});
const done = (outcome, over = {}) => row({ status: 'COMPLETED', ended_at: '2026-10-06T03:00:00Z', outcome, ...over });

const ROWS = [
  done('GRANTED'),
  done('GRANTED', { service_id: SERVICE_2 }),
  done('DISAPPROVED'),
  done(null), // completed before outcomes existed
  done('GRANTED', { office_id: OFFICE_B }),
  done('DISAPPROVED', { office_id: OFFICE_B }),
  row(), // in progress
  row({ status: 'ON_HOLD' }),
  row({ status: 'CANCELLED', ended_at: '2026-10-06T03:00:00Z' }),
  row({ status: 'AUTO_CLOSED', ended_at: '2026-10-06T03:00:00Z' }),
  row({ status: 'CANCELLED', ended_at: '2026-10-06T03:00:00Z', outcome: 'GRANTED' }), // never counted: not completed
  done('SOMETHING_ELSE'), // an unexpected value is never counted as either decision
  // Started in October, completed on 11/01 Manila time: received in October, completed in November.
  done('GRANTED', { started_at: '2026-10-31T01:00:00Z', ended_at: '2026-10-31T16:30:00Z' }),
  // Started in September, completed in October: counts as completed in October only.
  done('DISAPPROVED', { started_at: '2026-09-30T01:00:00Z', ended_at: '2026-10-02T03:00:00Z' }),
];
const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('CC050 outcome totals', () => {
  it('campus totals count completed rows only, by their exact outcome, with null as Not recorded', () => {
    const { totals } = computeKpis(ROWS, OCT);
    assert.deepEqual(totals.outcomes, { completed: 7, granted: 3, disapproved: 3, not_recorded: 1 });
  });

  it('the office filter applies to the outcome totals', () => {
    assert.deepEqual(computeKpis(ROWS, { ...OCT, officeId: OFFICE_B }).totals.outcomes, { completed: 2, granted: 1, disapproved: 1, not_recorded: 0 });
    assert.deepEqual(computeKpis(ROWS, { ...OCT, officeId: OFFICE_A }).totals.outcomes, { completed: 5, granted: 2, disapproved: 2, not_recorded: 1 });
  });

  it('the service filter applies to the outcome totals', () => {
    assert.deepEqual(computeKpis(ROWS, { ...OCT, serviceId: SERVICE_2 }).totals.outcomes, { completed: 1, granted: 1, disapproved: 0, not_recorded: 0 });
  });

  it('the date filter uses the Manila date of the completion (ended_at) for outcomes, and of the start for received', () => {
    const nov = computeKpis(ROWS, { from: '2026-11-01', to: '2026-11-30' }).totals;
    assert.deepEqual(nov.outcomes, { completed: 1, granted: 1, disapproved: 0, not_recorded: 0 });
    assert.equal(nov.received, 0, 'it was received in October');
    const sep = computeKpis(ROWS, { from: '2026-09-01', to: '2026-09-30' }).totals;
    assert.equal(sep.received, 1);
    assert.deepEqual(sep.outcomes, { completed: 0, granted: 0, disapproved: 0, not_recorded: 0 });
    const oneDay = computeKpis(ROWS, { from: '2026-10-02', to: '2026-10-02' }).totals;
    assert.deepEqual(oneDay.outcomes, { completed: 1, granted: 0, disapproved: 1, not_recorded: 0 });
  });

  it('grouped by office, each group has its own totals and they add up to the campus totals', () => {
    const { totals, groups } = computeKpis(ROWS, { ...OCT, groupBy: 'office' });
    const byOffice = Object.fromEntries(groups.map((g) => [g.office_id, g.outcomes]));
    assert.deepEqual(byOffice[OFFICE_B], { completed: 2, granted: 1, disapproved: 1, not_recorded: 0 });
    const sum = (k) => groups.reduce((n, g) => n + g.outcomes[k], 0);
    for (const k of ['completed', 'granted', 'disapproved', 'not_recorded']) assert.equal(sum(k), totals.outcomes[k], k);
  });

  it('the existing start figures are unchanged by the outcome totals', () => {
    const { totals } = computeKpis(ROWS, OCT);
    assert.equal(totals.received, ROWS.length - 1, 'every row except the one started in September');
    assert.equal(totals.backdated, 0);
    assert.equal(totals.not_in_registry, 0);
  });
});

describe('CC050 outcome totals through getStartKpis (stand-in data source)', () => {
  const capture = () => {
    const calls = [];
    return { calls, ds: { query: async (sql, params) => (calls.push({ sql, params }), ROWS) } };
  };

  it('reads status, outcome and ended_at, includes rows completed in the period, and never reads a reason column', async () => {
    const { calls, ds } = capture();
    const answer = await getStartKpis(ds, { role: ROLES.EXECUTIVE }, new URLSearchParams({ from: '2026-10-01', to: '2026-10-31' }));
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /\bstatus\b/);
    assert.match(calls[0].sql, /\boutcome\b/);
    assert.match(calls[0].sql, /ended_at >=/);
    assert.doesNotMatch(calls[0].sql, /disapproval|hold_reason|cancel_reason|backdate_reason|started_by|staff/i);
    assert.deepEqual(answer.totals.outcomes, { completed: 7, granted: 3, disapproved: 3, not_recorded: 1 });
  });

  it('keeps the existing access: an Office Head is limited to their office, and another office is refused before any read', async () => {
    const { calls, ds } = capture();
    const head = { role: ROLES.OFFICE_HEAD, officeId: OFFICE_A };
    const answer = await getStartKpis(ds, head, new URLSearchParams({ from: '2026-10-01', to: '2026-10-31' }));
    assert.equal(calls[0].params[2], OFFICE_A);
    assert.deepEqual(answer.totals.outcomes, { completed: 5, granted: 2, disapproved: 2, not_recorded: 1 });
    const refused = capture();
    await assert.rejects(getStartKpis(refused.ds, head, new URLSearchParams({ office_id: OFFICE_B })), (e) => e.status === 403);
    assert.equal(refused.calls.length, 0);
  });

  it('the analytics store has no disapproval text to count or leak (TT2 contract)', () => {
    for (const name of ANALYTICS_SNAPSHOT_FIELD_NAMES) assert.doesNotMatch(name, /disapproval|notice|email|client_reference|hold_reason|cancel_reason|backdate_reason|_name$/, name);
    assert.ok(ANALYTICS_SNAPSHOT_FIELD_NAMES.includes('outcome'));
  });
});
