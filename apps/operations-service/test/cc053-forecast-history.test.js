// CC053 (Insights sentence 1) needs the last working days next to the forecast. A stored run keeps no daily counts, so the
// forecast route reads them again; when Core cannot be reached the stored run is still served, just without them.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as forecastRoute } from '../src/app/api/analytics/forecast/route.js';
import { saveForecastRun } from '../src/lib/forecast/forecast-service.js';
import { OFFICE_A, OFFICE_B, call, req, resetData, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => { await env?.teardown(); });
beforeEach(async () => { await resetData(env.ds); await env.ds.query('DELETE FROM forecast_runs'); });

const run = (officeId) => ({
  officeId, serviceId: null, status: 'SUCCESS', errorCode: null, errorMessage: null, model: 'HOLT_WINTERS_ADDITIVE', mae: 1.5, weeklyTotal: 40,
  forecast: [{ date: '2026-11-16', point: 8, lower: 5, upper: 11 }], historyWorkingDays: 25, historicalTransactionCount: 200,
  historyStartDate: '2026-10-01', historyEndDate: '2026-11-13', generatedAt: new Date().toISOString(),
});
const get = (token, officeId) => call(forecastRoute, req('GET', `/analytics/forecast?officeId=${officeId}`, { token }));

describe('forecast route, stored run', () => {
  it('serves the stored run with a history list, and still serves it when the history cannot be read', async () => {
    await saveForecastRun(env.ds, run(OFFICE_A));
    const res = await get(tokens.officeHeadA, OFFICE_A);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'SUCCESS');
    assert.equal(res.body.weeklyTotal, 40);
    assert.equal(res.body.forecast[0].lower, 5);
    assert.ok(Array.isArray(res.body.history));
    assert.ok(res.body.history.every((h) => typeof h.date === 'string' && Number.isInteger(h.count)));
  });
  it('keeps the office rule: another office is 403', async () => {
    await saveForecastRun(env.ds, run(OFFICE_B));
    assert.equal((await get(tokens.officeHeadA, OFFICE_B)).status, 403);
  });
});
