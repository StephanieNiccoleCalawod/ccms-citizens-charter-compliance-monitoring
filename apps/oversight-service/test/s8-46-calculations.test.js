import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { computeKpis, getKpis } from '../src/modules/analytics/kpi.js';
import { charterCheck } from '../src/modules/insights/charter.js';
import { getCell, getInsights } from '../src/modules/insights/insights.js';

const office = '11111111-1111-4111-8111-111111111111';
const service = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-23T00:00:00Z');
const period = { from: '2026-11-01', to: '2026-11-23', now };
const row = (over = {}) => ({ office_id: office, service_id: service, service_code: 'S1', transaction_id: 't',
  tracking_no: 'T1', started_at: '2026-10-31T17:00:00Z', ended_at: '2026-11-02T01:00:00Z',
  status: 'COMPLETED', outcome: 'GRANTED', is_compliant: true, elapsed_working_minutes: 30, variance_minutes: -30,
  started_by_user_id: 'starter', ended_by_user_id: 'ender', ...over });

test('S8-46 KPI counts use metric-specific populations, filters and starter/ender attribution', () => {
  const rows = [row(), row({ is_compliant: false, elapsed_working_minutes: 90 }),
    row({ is_compliant: null, elapsed_working_minutes: null }), row({ status: 'CANCELLED', ended_at: null }),
    row({ status: 'AUTO_CLOSED', ended_at: null, is_compliant: null }),
    row({ status: 'IN_PROGRESS', ended_at: null, started_at: '2026-09-01T00:00:00Z' }),
    row({ office_id: 'other' }), row({ service_id: 'other' })];
  const { totals, groups } = computeKpis(rows, { ...period, officeId: office, serviceId: service, groupBy: 'staff' });
  assert.equal(totals.calculations.on_time_rate.data_used.record_count, 3);
  assert.equal(totals.calculations.median_minutes.data_used.record_count, 2);
  assert.equal(totals.calculations.p90_minutes.data_used.record_count, 2);
  assert.equal(totals.time.median_minutes, 60);
  assert.equal(totals.calculations.received.data_used.record_count, 5);
  assert.equal(totals.calculations.pending.data_used.record_count, 1);
  assert.equal(totals.calculations.pending.data_used.period_from, '2026-09-01');
  assert.equal(groups.find((g) => g.user_id === 'ender').calculations.median_minutes.data_used.record_count, 2);
  assert.equal(groups.find((g) => g.user_id === 'starter').calculations.median_minutes.data_used.record_count, 0);
});

test('S8-46 Charter metadata excludes unusable results and retains service sample for unusual cases', () => {
  assert.equal(charterCheck([], period).calculations.charter.data_used.record_count, 0);
  const rows = Array.from({ length: 20 }, (_, i) => row({ transaction_id: String(i), elapsed_working_minutes: i === 19 ? 900 : 30 }));
  const out = charterCheck([...rows, row({ is_compliant: null }), row({ elapsed_working_minutes: null })], period);
  assert.equal(out.services[0].calculations.charter.data_used.record_count, 20);
  assert.equal(out.unusual.length, 1);
  assert.equal(out.unusual[0].calculations.charter.data_used.record_count, 20);
  assert.equal(out.unusual[0].calculations.charter.parameters.iqr_factor, 3);
});

test('S8-46 Executive responses carry no staff identifiers; monthly and cell provenance match counts', async () => {
  const db = { query: async (sql) => sql.includes('sum(on_time)') ?
    [{ office_id: office, month: '2026-11', on_time: 1, late: 1, late_auto: 1 }] : [row()] };
  const actor = { role: ROLES.EXECUTIVE };
  const query = new URLSearchParams({ from: period.from, to: period.to, office_id: office, service_id: service });
  const overview = await getInsights(db, actor, query, now);
  const month = overview.calculations.monthly.find((m) => m.period === '2026-11');
  assert.equal(month.total.data_used.record_count, 3);
  assert.equal(month.offices[0].data_used.record_count, 3);
  assert.equal(overview.calculations.heatmap[0].data_used.record_count, 1);
  assert.equal(JSON.stringify(overview).includes('starter'), false);
  assert.equal(JSON.stringify(overview).includes('ender'), false);
  const cell = await getCell(db, actor, query, now);
  assert.equal(cell.calculations.weekly.data_used.record_count, 1);
  assert.equal(cell.calculations.late_transactions.data_used.record_count, 0);
  await assert.rejects(getKpis(db, actor, new URLSearchParams({ group_by: 'staff' }), now));
});
