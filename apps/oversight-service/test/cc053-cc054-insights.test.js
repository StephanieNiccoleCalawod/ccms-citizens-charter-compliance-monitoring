// CC053 Insights and CC054 Charter check: the pure rules, plus the routes against a real database.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as cellRoute } from '../src/app/api/analytics/insights/cell/route.js';
import { GET as overviewRoute } from '../src/app/api/analytics/insights/overview/route.js';
import { FLAG_FAR_LONGER, FLAG_NOT_ENOUGH, FLAG_OFTEN_MISSED, charterCheck } from '../src/modules/insights/charter.js';
import { buildHeatmap, buildOfficeTrend, previousPeriod } from '../src/modules/insights/insights.js';
import { buildSentences, rankSentences } from '../src/modules/insights/sentences.js';
import { OFFICE_A, OFFICE_B, call, req, setupTestEnv, tokens } from './helpers.js';

const SVC = '11111111-1111-4111-8111-111111111111';
const SVC2 = '22222222-2222-4222-8222-222222222222';
const done = (over = {}) => ({
  transaction_id: randomUUID(), tracking_no: 'T-1', office_id: OFFICE_A, service_id: SVC, service_code: 'SVC-1', status: 'COMPLETED',
  elapsed_working_minutes: 100, variance_minutes: -20, is_compliant: true, ended_at: '2026-10-06T03:00:00Z', ...over,
}); // limit = elapsed - variance = 120
const many = (n, over) => Array.from({ length: n }, (_, i) => done({ tracking_no: `T-${i}`, ...(typeof over === 'function' ? over(i) : over) }));

describe('CC054 Charter check', () => {
  it('limit often missed: more than 20% late, with 20 or more completed', () => {
    const rows = many(20, (i) => (i < 5 ? { is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 } : {}));
    const [s] = charterCheck(rows).services;
    assert.equal(s.completed, 20); assert.equal(s.late, 5); assert.equal(s.late_rate, 25);
    assert.ok(s.flags.includes(FLAG_OFTEN_MISSED));
    const exactly = charterCheck(many(20, (i) => (i < 4 ? { is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 } : {}))).services[0];
    assert.ok(!exactly.flags.includes(FLAG_OFTEN_MISSED)); // 20% is not more than 20%
  });
  it('limit far longer than real work: 90th percentile under 25% of the limit', () => {
    const [s] = charterCheck(many(20, { elapsed_working_minutes: 20, variance_minutes: -100 })).services; // limit 120, p90 20 = 16.7%
    assert.equal(s.limit_minutes, 120); assert.ok(s.flags.includes(FLAG_FAR_LONGER));
    const ok = charterCheck(many(20, { elapsed_working_minutes: 30, variance_minutes: -90 })).services[0]; // exactly 25%
    assert.ok(!ok.flags.includes(FLAG_FAR_LONGER));
  });
  it('19 completed shows not enough data and no flag and no outliers', () => {
    const rows = many(19, (i) => ({ is_compliant: false, elapsed_working_minutes: i === 0 ? 5000 : 130, variance_minutes: 10 }));
    const out = charterCheck(rows);
    assert.deepEqual(out.services[0].flags, [FLAG_NOT_ENOUGH]);
    assert.equal(out.unusual.length, 0);
  });
  it('a 25-row fixture with two planted outliers lists exactly those two', () => {
    const rows = many(25, (i) => ({ elapsed_working_minutes: 90 + (i % 5), variance_minutes: -30 + (i % 5) }));
    rows[3].elapsed_working_minutes = 900; rows[3].variance_minutes = 780; rows[3].is_compliant = false;
    rows[11].elapsed_working_minutes = 1200; rows[11].variance_minutes = 1080; rows[11].is_compliant = false;
    const out = charterCheck(rows);
    assert.deepEqual(out.unusual.map((u) => u.transaction_id).sort(), [rows[3].transaction_id, rows[11].transaction_id].sort());
  });
  it('ignores rows without a result and groups by office and service', () => {
    const rows = [...many(20, {}), done({ is_compliant: null }), done({ status: 'CANCELLED' }), ...many(20, { service_id: SVC2, service_code: 'SVC-2' })];
    const out = charterCheck(rows);
    assert.equal(out.services.length, 2);
    assert.ok(out.services.every((s) => s.completed === 20));
  });
});

describe('CC053 heatmap and sentences', () => {
  const period = { from: '2026-10-01', to: '2026-10-31' };
  it('a cell with 4 completed is too few; with 5 it is not', () => {
    const four = buildHeatmap(many(4, { is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 }), period);
    assert.equal(four[0].completed, 4); assert.equal(four[0].too_few, true);
    const five = buildHeatmap(many(5, { is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 }), period);
    assert.equal(five[0].too_few, false); assert.equal(five[0].late_rate, 100);
  });
  it('the previous period is the same length right before', () => {
    assert.deepEqual(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-08-31', to: '2026-09-30' });
    assert.deepEqual(previousPeriod({ from: '2026-11-02', to: '2026-11-08' }), { from: '2026-10-26', to: '2026-11-01' });
  });
  const base = { period: 'monthly', services: [], officeTrend: [], charter: { services: [], unusual: [] } };
  it('says nothing when there is nothing to say', () => {
    assert.deepEqual(buildSentences(base), []);
    const thin = buildSentences({ ...base, services: [{ service_id: SVC, service_code: 'S', completed: 19, late: 19 }], officeTrend: [{ office_id: OFFICE_A, completed: 29, first_completed: 10, first_late: 0, last_completed: 10, last_late: 9 }] });
    assert.deepEqual(thin, []); // 19 completed (sentence 2) and 29 completed (sentence 3) are under the minimum
  });
  it('sentence 2: a service late 20% or more, with 20 or more completed', () => {
    const at = buildSentences({ ...base, services: [{ service_id: SVC, service_code: 'S1', completed: 20, late: 4 }] }); // exactly 20%
    assert.deepEqual(at.map((s) => s.template), [2]);
    assert.equal(at[0].params.late_rate, 20); assert.equal(at[0].params.period, 'monthly');
    assert.deepEqual(buildSentences({ ...base, services: [{ service_id: SVC, service_code: 'S1', completed: 20, late: 3 }] }), []); // 15%
  });
  it('sentence 3: first against last third, a change of 10 points or more, 30 or more completed', () => {
    const fell = buildSentences({ ...base, officeTrend: [{ office_id: OFFICE_A, completed: 30, first_completed: 10, first_late: 6, last_completed: 10, last_late: 2 }] });
    assert.deepEqual(fell.map((s) => s.template), [3]);
    assert.deepEqual([fell[0].params.from_rate, fell[0].params.to_rate, fell[0].params.direction, fell[0].kind], [60, 20, 'fell', 'positive']);
    const rose = buildSentences({ ...base, officeTrend: [{ office_id: OFFICE_A, completed: 30, first_completed: 10, first_late: 1, last_completed: 10, last_late: 3 }] });
    assert.equal(rose[0].params.direction, 'rose');
    const exactly = buildSentences({ ...base, officeTrend: [{ office_id: OFFICE_A, completed: 30, first_completed: 10, first_late: 2, last_completed: 10, last_late: 3 }] }); // 20% to 30%: exactly 10 points counts
    assert.equal(exactly.length, 1);
    assert.deepEqual(buildSentences({ ...base, officeTrend: [{ office_id: OFFICE_A, completed: 200, first_completed: 100, first_late: 20, last_completed: 100, last_late: 29 }] }), []); // 20% to 29%: 9 points does not
  });
  it('the thirds are cut by the date a transaction ended', () => {
    const rows = [
      ...many(5, { ended_at: '2026-10-02T03:00:00Z', is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 }), // first third
      ...many(5, { ended_at: '2026-10-15T03:00:00Z' }), // middle: in no third
      ...many(5, { ended_at: '2026-10-30T03:00:00Z' }), // last third
    ];
    const [o] = buildOfficeTrend(rows, { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual([o.completed, o.first_completed, o.first_late, o.last_completed, o.last_late], [15, 5, 5, 5, 0]);
  });
  it('sentence 4: the Charter check flag "far longer" becomes "usually done in x% of the limit"', () => {
    const out = buildSentences({ ...base, charter: { services: [{ office_id: OFFICE_A, service_id: SVC, service_code: 'S', flags: [FLAG_FAR_LONGER], completed: 20, p90_share_of_limit: 16.7 }], unusual: [] } });
    assert.deepEqual(out.map((s) => s.template), [4]); assert.equal(out[0].params.share_of_limit, 16.7);
    assert.deepEqual(buildSentences({ ...base, charter: { services: [{ office_id: OFFICE_A, service_id: SVC, flags: [FLAG_OFTEN_MISSED], completed: 30, p90_share_of_limit: 90 }], unusual: [] } }), []);
  });
  it('sentence 5: one sentence with the number of unusual cases, once there is at least one', () => {
    const out = buildSentences({ ...base, charter: { services: [], unusual: [{}, {}] } });
    assert.deepEqual(out.map((s) => [s.template, s.params.n]), [[5, 2]]);
  });
  it('every sentence carries the numbers of its chart and a score; the six are ranked by effect x volume and cut', () => {
    const out = buildSentences({
      ...base,
      services: Array.from({ length: 8 }, (_, i) => ({ service_id: `s${i}`, service_code: `S${i}`, completed: 20 + i, late: 10 + i })),
      charter: { services: [], unusual: [{}] },
    });
    assert.ok(out.every((s) => s.chart && s.kind && typeof s.score === 'number' && s.params));
    assert.ok(out.every((s, i) => i === 0 || out[i - 1].score >= s.score));
    assert.equal(rankSentences(out).length, 6);
    assert.equal(rankSentences(out)[0].params.service_code, 'S7'); // the most late transactions first
  });
});

describe('Insights routes', () => {
  let env;
  before(async () => { env = await setupTestEnv(); });
  after(async () => { await env?.teardown(); });
  beforeEach(async () => { await env.ds.query('DELETE FROM analytics_transactions'); });

  async function seed(rowsIn) {
    for (const [i, r] of rowsIn.entries()) {
      await env.ds.query(
        `INSERT INTO analytics_transactions (transaction_id, tracking_no, office_id, service_id, service_code, classification, client_type, standard_days, standard_hours, standard_minutes,
           started_at, ended_at, status, elapsed_working_minutes, is_compliant, variance_minutes, held_minutes, is_backdated, started_outside_hours, registry_status, started_by_user_id, event_version, is_seeded, received_at)
         VALUES ($1,$2,$3,$4,$5,'SIMPLE','STUDENT',0,2,0,$6,$7,'COMPLETED',$8,$9,$10,0,false,false,'NONE',$11,1,false,now())`,
        [r.transaction_id, `PUP-${i}`, r.office_id, r.service_id, r.service_code, r.started_at ?? '2026-10-05T01:00:00Z', r.ended_at, r.elapsed_working_minutes, r.is_compliant, r.variance_minutes, randomUUID()],
      );
    }
  }
  const get = (token, qs = '') => call(overviewRoute, req('GET', `/analytics/insights/overview${qs}`, { token }));
  const OCT = '?period=custom&from=2026-10-01&to=2026-10-31';

  it('empty data gives empty sections, not an error', async () => {
    const r = await get(tokens.superAdmin, OCT);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.heatmap, []); assert.deepEqual(r.body.sentences, []); assert.deepEqual(r.body.charter.services, []);
    assert.equal(r.body.pulse.open_now, 0);
  });
  it('a cell with 4 completed is "too few"; scope follows the role', async () => {
    await seed([...many(4, { office_id: OFFICE_A, is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 }), ...many(6, { office_id: OFFICE_B, service_id: SVC2, service_code: 'SVC-2' })]);
    const all = await get(tokens.superAdmin, OCT);
    assert.equal(all.body.heatmap.length, 2);
    assert.equal(all.body.heatmap.find((c) => c.office_id === OFFICE_A).too_few, true);
    assert.equal((await get(tokens.executive, OCT)).body.heatmap.length, 2);
    const head = await get(tokens.officeHeadA, OCT);
    assert.deepEqual(head.body.heatmap.map((c) => c.office_id), [OFFICE_A]);
    assert.equal((await get(tokens.officeHeadA, `${OCT}&office_id=${OFFICE_B}`)).status, 403);
    assert.equal((await get(tokens.officeStaffA, OCT)).status, 200);
    assert.equal((await get(null, OCT)).status, 401);
  });
  it('the Charter check and sentences appear once a flag exists; the response has no per-staff fields', async () => {
    await seed(many(20, (i) => (i < 8 ? { is_compliant: false, elapsed_working_minutes: 130, variance_minutes: 10 } : {})));
    const r = await get(tokens.executive, OCT);
    assert.ok(r.body.charter.services[0].flags.includes(FLAG_OFTEN_MISSED));
    assert.ok(r.body.sentences.some((s) => s.template === 2)); // 40% late with 20 completed
    assert.equal(r.body.max_sentences, 6);
    assert.ok(!JSON.stringify(r.body).includes('started_by') && !JSON.stringify(r.body).includes('ended_by'));
  });
  it('the cell route gives the weekly trend and the late transactions, within the caller scope', async () => {
    await seed(many(6, (i) => ({ is_compliant: i < 2, elapsed_working_minutes: i < 2 ? 100 : 130, variance_minutes: i < 2 ? -20 : 10, ended_at: i < 3 ? '2026-10-06T03:00:00Z' : '2026-10-13T03:00:00Z' })));
    const q = `${OCT}&office_id=${OFFICE_A}&service_id=${SVC}`;
    const ok = await call(cellRoute, req('GET', `/analytics/insights/cell${q}`, { token: tokens.officeHeadA }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.weekly.length, 2); assert.equal(ok.body.late_transactions.length, 4);
    const other = await call(cellRoute, req('GET', `/analytics/insights/cell${q}`, { token: tokens.officeHeadB }));
    assert.equal(other.status, 403);
    assert.equal((await call(cellRoute, req('GET', `/analytics/insights/cell${OCT}&office_id=${OFFICE_A}`, { token: tokens.superAdmin }))).status, 400);
  });
  it('rejects a bad office or period', async () => {
    assert.equal((await get(tokens.superAdmin, '?office_id=nope')).status, 400);
    assert.equal((await get(tokens.superAdmin, '?period=decade')).status, 400);
  });
});
