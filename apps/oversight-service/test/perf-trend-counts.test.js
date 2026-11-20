// The six-month trend and compliance heatmap are counted by the database (not by pulling every row into Node). These tests pin
// the rules the KPI module uses, at the edges: Manila month boundaries, auto-closed rows, cancelled rows, and offices that only
// appear because something started in the window.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getInsights } from '../src/modules/insights/insights.js';
import { OFFICE_A, OFFICE_B, USERS, setupTestEnv } from './helpers.js';

describe('Insights trend counts (database side)', () => {
  let env;
  before(async () => { env = await setupTestEnv(); });
  after(async () => { await env?.teardown(); });
  beforeEach(async () => { await env.ds.query('DELETE FROM analytics_transactions'); });

  const SERVICE = '11111111-1111-4111-8111-111111111111';
  const NOW = new Date('2026-11-18T04:00:00Z');
  const admin = { id: USERS.adminId, role: 'super_admin', officeId: null };

  async function insert(row) {
    await env.ds.query(
      `INSERT INTO analytics_transactions (transaction_id, tracking_no, office_id, service_id, service_code, classification, client_type,
         standard_days, standard_hours, standard_minutes, started_at, ended_at, status, elapsed_working_minutes, is_compliant, variance_minutes,
         held_minutes, is_backdated, started_outside_hours, registry_status, started_by_user_id, event_version, is_seeded, received_at)
       VALUES ($1,$2,$3,$4,'SVC-1','SIMPLE','STUDENT',0,2,0,$5,$6,$7,$8,$9,$10,0,false,false,'NONE',$11,1,false,now())`,
      [randomUUID(), `PUP-${randomUUID().slice(0, 8)}`, row.office ?? OFFICE_A, SERVICE, row.started, row.ended ?? null, row.status ?? 'COMPLETED',
        row.ended ? 60 : null, row.compliant ?? null, row.compliant === false ? 10 : -10, USERS.staffA],
    );
  }
  const point = (result, key) => result.pulse.trend.find((p) => p.period === key).value;

  it('places a completion by its Manila month: 00:00 Manila is the new month, one second earlier is the old one', async () => {
    await insert({ started: '2026-09-30T01:00:00Z', ended: '2026-09-30T15:59:59Z', compliant: false }); // 23:59:59 Manila on Sep 30
    await insert({ started: '2026-09-30T02:00:00Z', ended: '2026-09-30T16:00:00Z', compliant: true }); // 00:00:00 Manila on Oct 1
    const result = await getInsights(env.ds, admin, { period: 'monthly' }, NOW);
    assert.equal(point(result, '2026-09'), 0);
    assert.equal(point(result, '2026-10'), 100);
  });

  it('counts an auto-closed row as late by its start month unless it is marked on time (K27), and ignores cancelled rows', async () => {
    await insert({ started: '2026-10-05T01:00:00Z', ended: '2026-10-05T03:00:00Z', compliant: true });
    await insert({ started: '2026-10-06T01:00:00Z', status: 'AUTO_CLOSED', compliant: null });
    await insert({ started: '2026-10-07T01:00:00Z', status: 'AUTO_CLOSED', compliant: true }); // marked on time: stays out of the rate
    await insert({ started: '2026-10-08T01:00:00Z', status: 'CANCELLED' });
    const result = await getInsights(env.ds, admin, { period: 'monthly' }, NOW);
    assert.equal(point(result, '2026-10'), 50); // 1 on time / (1 on time + 1 auto-closed late)
  });

  it('gives no rate (never 0 or 100) for a month with nothing to divide by', async () => {
    await insert({ started: '2026-10-08T01:00:00Z', status: 'CANCELLED' });
    const result = await getInsights(env.ds, admin, { period: 'monthly' }, NOW);
    assert.equal(point(result, '2026-10'), null);
    assert.equal(point(result, '2026-09'), null);
  });

  it('lists an office on the heatmap as soon as something started in the window, with empty cells where there is no rate', async () => {
    await insert({ office: OFFICE_B, started: '2026-10-08T01:00:00Z', status: 'CANCELLED' });
    await insert({ office: OFFICE_A, started: '2026-10-05T01:00:00Z', ended: '2026-10-05T03:00:00Z', compliant: true });
    const result = await getInsights(env.ds, admin, { period: 'monthly' }, NOW);
    assert.deepEqual(result.compliance_heatmap.rows.map((r) => r.office_id).sort(), [OFFICE_A, OFFICE_B].sort());
    const b = result.compliance_heatmap.rows.find((r) => r.office_id === OFFICE_B);
    assert.ok(b.cells.every((c) => c.value === null));
    assert.equal(result.compliance_heatmap.rows.find((r) => r.office_id === OFFICE_A).cells.find((c) => c.period === '2026-10').value, 100);
  });

  it('ignores rows outside the six months and keeps one line per month in order', async () => {
    await insert({ started: '2026-04-30T01:00:00Z', ended: '2026-04-30T03:00:00Z', compliant: false }); // before the window
    const result = await getInsights(env.ds, admin, { period: 'monthly' }, NOW);
    assert.deepEqual(result.pulse.trend.map((p) => p.period), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    assert.ok(result.pulse.trend.every((p) => p.value === null));
    assert.deepEqual(result.compliance_heatmap.rows, []);
  });
});
