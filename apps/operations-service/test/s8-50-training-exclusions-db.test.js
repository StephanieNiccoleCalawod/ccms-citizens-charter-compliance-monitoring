import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { computeForecast, saveForecastRun } from '../src/lib/forecast/forecast-service.js';
import { OFFICE_A, SERVICE_A, insertTransaction, setupTestEnv } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => { await env?.teardown(); });
test('S8-50 real SQL excludes one slow completion, persists the count and retains all report rows', async () => {
  const now = new Date('2026-11-24T04:00:00Z');
  for (let i = 0; i < 21; i++) await insertTransaction(env.ds, {
    office_id: OFFICE_A, service_id: SERVICE_A, status: 'COMPLETED',
    started_at: '2026-11-20T01:00:00Z', ended_at: '2026-11-20T03:00:00Z',
    elapsed_working_minutes: i === 20 ? 1000 : 10, variance_minutes: i === 20 ? 990 : 0, is_compliant: i !== 20,
  });
  const calendar = { isWorkingDay: async () => true,
    nextWorkingDays: async () => ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'] };
  const result = await computeForecast(env.ds, calendar, { officeId: OFFICE_A, now });
  assert.equal(result.excludedTransactionCount, 1);
  assert.equal(result.historicalTransactionCount, 20);
  const id = await saveForecastRun(env.ds, result);
  const [saved] = await env.ds.query('SELECT excluded_transaction_count FROM forecast_runs WHERE id = $1', [id]);
  assert.equal(saved.excluded_transaction_count, 1);
  const [reports] = await env.ds.query('SELECT count(*)::int AS count FROM transactions WHERE office_id = $1', [OFFICE_A]);
  assert.equal(reports.count, 21);
});
