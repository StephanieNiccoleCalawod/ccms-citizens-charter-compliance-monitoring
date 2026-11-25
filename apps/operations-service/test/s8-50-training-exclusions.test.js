import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { slowCaseIds } from '../src/modules/analytics/slow-cases.js';
import { trainLateRisk } from '../src/modules/analytics/late-risk.js';
import { computeForecast, saveForecastRun } from '../src/lib/forecast/forecast-service.js';
import { S850TrainingExclusions1795478400000 } from '../migrations/1795478400000-S850TrainingExclusions.js';

const now = new Date('2026-11-24T04:00:00Z');
const rows = Array.from({ length: 21 }, (_, i) => ({ transaction_id: `tx-${i}`, office_id: 'office', service_id: 'service',
  status: 'COMPLETED', elapsed_working_minutes: i === 20 ? 1000 : 10, variance_minutes: i === 20 ? 990 : 0,
  is_compliant: i !== 20, ended_at: '2026-11-20T03:00:00Z', started_at: '2026-11-20T01:00:00Z',
  standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, held_minutes: 0, hold_events: [] }));

test('S8-50 per-office/service fence excludes only strictly slow usable completions and needs 20 records', () => {
  assert.deepEqual([...slowCaseIds(rows)], ['tx-20']);
  assert.equal(rows.length, 21, 'reports retain the original rows');
  assert.equal(slowCaseIds(rows.slice(2)).size, 0);
  assert.equal(slowCaseIds(rows.map((r, i) => ({ ...r, service_id: `service-${i}` }))).size, 0);
  assert.equal(slowCaseIds(rows.map((r, i) => ({ ...r, office_id: `office-${i}` }))).size, 0);
  assert.equal(slowCaseIds(rows.map((r) => ({ ...r, elapsed_working_minutes: 10 }))).size, 0, 'equality at zero IQR is retained');
  assert.equal(slowCaseIds(rows.map((r) => ({ ...r, variance_minutes: null }))).size, 0);
});

test('S8-50 late-risk measures 20 retained rows and persists the excluded count without deleting reports', async () => {
  let measured = 0, saved;
  const manager = { query: async (sql, args) => {
    if (sql.includes('pg_try_advisory')) return [{ acquired: true }];
    if (sql.includes('FROM transactions t')) return rows;
    if (sql.startsWith('INSERT INTO late_risk_runs')) {
      saved = args;
      return [{ status: args[0], rows: args[1], excluded_rows: args[5], coefficients: JSON.parse(args[7]), created_at: now }];
    }
    assert.fail(sql);
  } };
  await trainLateRisk({ transaction: (fn) => fn(manager) }, { now, timing: { baseUrl: 'http://core/api', key: 'test',
    fetcher: async (_url, init) => {
      const items = JSON.parse(init.body).items;
      measured += items.length;
      assert.ok(items.every((item) => item.elapsed === 10));
      return new Response(JSON.stringify({ items: items.map(() => ({ at: now.toISOString(), used: 5, limit: 60, onHold: false, workingDays: [] })) }));
    } } });
  assert.equal(measured, 20);
  assert.equal(saved[5], 1);
  assert.equal(JSON.parse(saved[7]).training_data.excluded_slow_cases, 1);
  assert.equal(rows.length, 21);
});

test('S8-50 forecast retains zero-filled days and persists exclusions from selected working days only', async () => {
  let saved;
  const db = { query: async (sql, args) => {
    if (sql.startsWith('INSERT INTO forecast_runs')) { saved = args; return [{ id: 'run' }]; }
    return [{ working_date: '2026-11-23', cnt: 20, excluded_count: 1 },
      { working_date: '2026-01-01', cnt: 5, excluded_count: 99 }];
  } };
  const calendar = { isWorkingDay: async () => true,
    nextWorkingDays: async () => ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'] };
  const result = await computeForecast(db, calendar, { officeId: 'office', now });
  assert.equal(result.excludedTransactionCount, 1);
  assert.equal(result.historicalTransactionCount, 20);
  assert.equal(result.history.length, 30);
  assert.equal(result.history.at(-1).count, 20);
  await saveForecastRun(db, result);
  assert.equal(saved[14], 1);
});

test('S8-50 migration adds a nullable non-negative counter without rewriting old forecast runs', async () => {
  const queries = [];
  await new S850TrainingExclusions1795478400000().up({ query: async (sql) => queries.push(sql) });
  assert.match(queries[0], /ADD COLUMN excluded_transaction_count integer CHECK/);
  assert.doesNotMatch(queries[0], /DEFAULT|UPDATE|DELETE/);
});
