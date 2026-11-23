import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { formatForecastResult, formatStoredRun } from '../src/lib/forecast/forecast-service.js';
import { readLateRisk, trainLateRisk } from '../src/modules/analytics/late-risk.js';
import { ratingSummary } from '../src/modules/ratings/ratings.js';

const at = new Date('2026-11-23T01:00:00Z');
test('S8-46 forecast provenance reuses the saved training range, count, method and timestamp', () => {
  const stored = formatStoredRun({ status: 'SUCCESS', historical_transaction_count: 64,
    history_start_date: '2026-10-01', history_end_date: '2026-11-20', selected_model: 'SEASONAL_NAIVE', generated_at: at }, { stale: true });
  const c = stored.calculations.forecast;
  assert.equal(c.data_used.record_count, 64);
  assert.equal(c.data_used.period_from, '2026-10-01');
  assert.equal(c.data_used.period_to, '2026-11-20');
  assert.equal(c.method, 'SEASONAL_NAIVE');
  assert.equal(c.last_run_at, at.toISOString());
  assert.equal(stored.stale, true);
  const fresh = formatForecastResult({ status: 'SUCCESS', historicalTransactionCount: 64,
    historyStartDate: '2026-10-01', historyEndDate: '2026-11-20', model: 'SEASONAL_NAIVE', generatedAt: at.toISOString() });
  assert.deepEqual(fresh.calculations, stored.calculations);
  const empty = formatForecastResult({ status: 'TOO_FEW', model: 'NONE', historicalTransactionCount: 12, generatedAt: at.toISOString() });
  assert.equal(empty.calculations.forecast.data_used.period_from, null);
  assert.match(empty.calculations.forecast.data_used.date_basis, /eligibility/);
});

test('S8-46 late-risk provenance counts scored open rows, keeps cached/stale provenance and strips staff', async () => {
  let cache;
  const rows = [
    { transaction_id: '1', tracking_no: 'T1', service_name: 'Service', office_id: 'office', service_id: 'service',
      status: 'IN_PROGRESS', started_at: '2026-11-22T17:00:00Z', started_by: 'secret-person',
      standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, held_minutes: 0, hold_started_at: null },
    { transaction_id: '2', status: 'CANCELLED', started_at: '2026-10-01T00:00:00Z', closed_at: '2026-10-02T00:00:00Z' },
  ];
  const db = { query: async (sql, args) => {
    if (sql.includes('FROM late_risk_runs')) return [];
    if (sql.startsWith('SELECT scored_at')) return cache ? [cache] : [];
    if (sql.startsWith('INSERT INTO late_risk_score_cache')) {
      cache = { scored_at: args[1], run_id: args[2], payload: JSON.parse(args[3]) }; return [];
    }
    return rows;
  } };
  const actor = { role: ROLES.EXECUTIVE };
  const timing = { baseUrl: 'http://core/api', key: 'test', fetcher: async () => new Response(JSON.stringify({
    items: [{ at: at.toISOString(), used: 55, limit: 60, onHold: false, workingDays: [] }],
  })) };
  const first = await readLateRisk(db, 'office', actor, { now: at, timing });
  assert.equal(first.calculations.late_risk.data_used.record_count, 1);
  assert.equal(first.calculations.late_risk.data_used.period_from, '2026-11-23');
  assert.equal(first.calculations.context.data_used.record_count, 2);
  assert.equal(first.calculations.late_risk.method, 'allowed-time-share rule');
  assert.equal(JSON.stringify(first).includes('secret-person'), false);
  assert.equal(Object.hasOwn(first.items[0], 'probability'), false);
  const fail = { ...timing, fetcher: async () => { throw new Error('offline'); } };
  const cached = await readLateRisk(db, 'office', actor, { now: new Date(at.getTime() + 1000), timing: fail });
  assert.deepEqual(cached.calculations, first.calculations);
  const stale = await readLateRisk(db, 'office', actor, { now: new Date(at.getTime() + 120000), timing: fail });
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.calculations, first.calculations);
});

test('S8-46 ratings use submitted counts and Manila rating dates within authorized office', async () => {
  const office = '11111111-1111-4111-8111-111111111111';
  const db = { query: async (sql, args) => {
    assert.equal(args[0], office);
    assert.match(sql, /stars IS NOT NULL/);
    return [{ service_id: 'service', count: 2, average: 4.5,
      first_rated_at: '2026-11-01T17:00:00Z', last_rated_at: '2026-11-20T00:00:00Z' }];
  } };
  const result = await ratingSummary(db, { role: ROLES.OFFICE_HEAD, officeId: office }, new URLSearchParams(), at);
  assert.equal(result.calculations.ratings.data_used.record_count, 2);
  assert.equal(result.calculations.ratings.data_used.period_from, '2026-11-02');
  assert.equal(result.items[0].calculations.ratings.data_used.period_to, '2026-11-20');
  await assert.rejects(ratingSummary(db, { role: ROLES.OFFICE_HEAD, officeId: office },
    new URLSearchParams({ office_id: '22222222-2222-4222-8222-222222222222' }), at));
});

test('S8-46 training persists aggregate source dates with the fitted samples and no staff identity', async () => {
  let saved;
  const rows = Array.from({ length: 160 }, (_, i) => ({
    transaction_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    office_id: 'office', service_id: 'service', service_classification: 'SIMPLE',
    started_at: '2026-11-01T01:00:00Z', ended_at: '2026-11-02T01:00:00Z', closed_at: '2026-11-02T01:00:00Z',
    status: 'COMPLETED', is_compliant: i >= 80, elapsed_working_minutes: i >= 80 ? 30 : 90,
    variance_minutes: i >= 80 ? -30 : 30, standard_duration_days: 0,
    standard_duration_hours: 1, standard_duration_minutes: 0, held_minutes: 0, hold_events: [], started_by: 'secret-staff',
  }));
  const manager = { query: async (sql, args) => {
    if (sql.includes('pg_try_advisory')) return [{ acquired: true }];
    if (sql.startsWith('INSERT INTO late_risk_runs')) {
      saved = JSON.parse(args[7]);
      return [{ status: args[0], rows: args[1], training_rows: args[2], holdout_rows: args[3],
        late_cases: args[4], excluded_rows: args[5], coefficients: saved, created_at: at }];
    }
    return rows;
  } };
  const timing = { baseUrl: 'http://core/api', key: 'test', fetcher: async (_url, init) => new Response(JSON.stringify({
    items: JSON.parse(init.body).items.map((i) => ({ at: i.end, used: i.elapsed, limit: 60, onHold: false, workingDays: [] })),
  })) };
  const result = await trainLateRisk({ transaction: (fn) => fn(manager) }, { now: at, timing });
  assert.equal(saved.training_data.record_count, 160);
  assert.equal(saved.training_data.period_from, '2026-11-02');
  assert.equal(result.model.calculations.training.data_used.record_count, 160);
  assert.equal(result.model.calculations.training.data_used.period_to, '2026-11-02');
  assert.equal(JSON.stringify(result).includes('secret-staff'), false);
});
