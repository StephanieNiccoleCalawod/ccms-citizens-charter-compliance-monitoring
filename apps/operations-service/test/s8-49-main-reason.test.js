import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { readLateRisk } from '../src/modules/analytics/late-risk.js';

const now = new Date('2026-11-24T04:00:00Z');
const officeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = { role: ROLES.OFFICE_HEAD, officeId };
const expectedCodes = ['TIME_SHARE', 'SERVICE_SIMPLE', 'SERVICE_COMPLEX', 'SERVICE_HIGHLY_TECHNICAL',
  'SERVICE_OFFICE_PACE', 'OFFICE_WORKLOAD', 'ON_HOLD', ...Array(7).fill('WORKING_WEEKDAY')];
const model = (weights, extra = {}) => ({ version: 1, weights, means: Array(14).fill(0), scales: Array(14).fill(1), intercept: 0, ...extra });

function fixture({ coefficients = null, share = 0.8, cache: initialCache = null, fail = false } = {}) {
  let cache = initialCache;
  let calendarCalls = 0;
  const run = coefficients ? { run_id: 'run-1', status: 'TRAINED', created_at: now, coefficients } : null;
  const row = { transaction_id: 'tx-1', tracking_no: 'T1', service_name: 'Service', office_id: officeId,
    service_id: 'service', service_classification: 'SIMPLE', started_by: 'staff-secret',
    status: 'IN_PROGRESS', started_at: '2026-11-23T01:00:00Z', closed_at: null,
    standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0,
    held_minutes: 0, hold_started_at: null };
  const db = { query: async (sql, args) => {
    if (sql.includes('FROM late_risk_runs')) return run ? [run] : [];
    if (sql.startsWith('SELECT scored_at')) return cache ? [cache] : [];
    if (sql.includes('FROM transactions t')) return [row];
    if (sql.startsWith('INSERT INTO late_risk_score_cache')) {
      cache = { scored_at: args[1], run_id: args[2], payload: JSON.parse(args[3]) };
      return [];
    }
    assert.fail(`Unexpected query: ${sql}`);
  } };
  const timing = { baseUrl: 'http://core/api', key: 'test', fetcher: async () => {
    calendarCalls++;
    if (fail) throw new Error('offline');
    return new Response(JSON.stringify({ items: [{ at: now.toISOString(), used: share * 100, limit: 100,
      onHold: false, workingDays: ['2026-11-23'] }] }));
  } };
  return { read: (user = actor, at = now) => readLateRisk(db, officeId, user, { now: at, timing }),
    cache: () => cache, calls: () => calendarCalls };
}

test('S8-49 rule reasons identify the actual threshold, including exact boundaries', async () => {
  for (const [share, level] of [[0, 'LOW'], [0.499, 'LOW'], [0.5, 'MEDIUM'], [0.799, 'MEDIUM'], [0.8, 'HIGH'], [1.2, 'HIGH']]) {
    const response = await fixture({ share }).read();
    assert.equal(response.items[0].level, level);
    assert.equal(response.items[0].main_reason_code, `TIME_SHARE_${level}`);
    assert.equal(response.items[0].reason, `${Math.round(share * 100)}% of the time limit used`);
  }
});

test('S8-49 every model feature maps its greatest positive standardized contribution to a reason code', async () => {
  for (let index = 0; index < 14; index++) {
    const weights = Array(14).fill(0);
    weights[index] = 2;
    const response = await fixture({ coefficients: model(weights, { means: Array(14).fill(-1) }) }).read();
    assert.equal(response.items[0].main_reason_code, expectedCodes[index], `feature ${index}`);
    assert.equal(response.items[0].rule_based, false);
  }
});

test('S8-49 uses contribution size rather than raw weight or absolute magnitude', async () => {
  const weights = Array(14).fill(0);
  weights[0] = 100;
  weights[4] = -1000;
  weights[5] = 2;
  const scales = Array(14).fill(1);
  scales[0] = 100;
  const response = await fixture({ coefficients: model(weights, { scales }) }).read();
  assert.equal(response.items[0].main_reason_code, 'OFFICE_WORKLOAD');
});

test('S8-49 equal positive contributions use feature order and non-positive contributions use the model baseline', async () => {
  const weights = Array(14).fill(0);
  weights[0] = 1.25; // 0.8 * 1.25 = 1, equal to workload 1 * 1.
  weights[5] = 1;
  assert.equal((await fixture({ coefficients: model(weights) }).read()).items[0].main_reason_code, 'TIME_SHARE');
  for (const value of [0, -1]) {
    const response = await fixture({ coefficients: model(Array(14).fill(value), { intercept: 20 }) }).read();
    assert.equal(response.items[0].main_reason_code, 'MODEL_BASELINE');
    assert.match(response.items[0].reason, /no individual factor increases/);
    assert.equal(response.items[0].level, 'HIGH', 'baseline explanation must not change the probability or level');
  }
});

test('S8-49 reason codes survive cached and stale reads while staff and probabilities stay restricted', async () => {
  const f = fixture();
  const first = await f.read();
  const cached = await f.read({ role: ROLES.EXECUTIVE }, new Date(now.getTime() + 1000));
  assert.equal(f.calls(), 1);
  assert.equal(cached.items[0].main_reason_code, first.items[0].main_reason_code);
  assert.equal(cached.items[0].probability, undefined);
  assert.equal(JSON.stringify(cached).includes('staff-secret'), false);
  const down = fixture({ cache: f.cache(), fail: true });
  const stale = await down.read({ role: ROLES.EXECUTIVE }, new Date(now.getTime() + 120000));
  assert.equal(stale.stale, true);
  assert.equal(stale.items[0].main_reason_code, first.items[0].main_reason_code);
  assert.equal(JSON.stringify(stale).includes('staff-secret'), false);
});

test('S8-49 legacy caches refresh even inside TTL; during outages rules remain explainable and trained reasons are unavailable', async () => {
  for (const trained of [false, true]) {
    const seed = fixture({ coefficients: trained ? model(Array(14).fill(0)) : null });
    await seed.read();
    const oldCache = structuredClone(seed.cache());
    delete oldCache.payload.items[0].main_reason_code;
    const refreshed = fixture({ coefficients: trained ? model(Array(14).fill(0)) : null, cache: oldCache });
    const fresh = await refreshed.read();
    assert.equal(refreshed.calls(), 1);
    assert.equal(fresh.items[0].main_reason_code, trained ? 'MODEL_BASELINE' : 'TIME_SHARE_HIGH');
    const down = fixture({ coefficients: trained ? model(Array(14).fill(0)) : null, cache: oldCache, fail: true });
    const stale = await down.read();
    assert.equal(stale.stale, true);
    assert.equal(stale.items[0].main_reason_code, trained ? 'MAIN_REASON_UNAVAILABLE' : 'TIME_SHARE_HIGH');
  }
});
