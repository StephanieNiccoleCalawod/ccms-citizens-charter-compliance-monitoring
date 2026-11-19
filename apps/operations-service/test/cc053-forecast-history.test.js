// CC053 (Insights sentence 1) & R1 forecast freshness / stale fallback / case-insensitive UUID RBAC tests.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as forecastRoute } from '../src/app/api/analytics/forecast/route.js';
import { POST as retrainRoute } from '../src/app/api/analytics/forecast/retrain/route.js';
import { buildHistorySeries } from '../src/lib/forecast/aggregator.js';
import { CoreCalendarError } from '../src/lib/forecast/calendar-client.js';
import { computeForecast, isForecastFreshForToday, readForecast, saveForecastRun } from '../src/lib/forecast/forecast-service.js';
import { OFFICE_A, OFFICE_B, SERVICE_A, call, insertTransaction, req, resetData, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => { await env?.teardown(); });
beforeEach(async () => { await resetData(env.ds); await env.ds.query('DELETE FROM forecast_runs'); });

const run = (officeId, over = {}) => ({
  officeId, serviceId: null, status: 'SUCCESS', errorCode: null, errorMessage: null, model: 'HOLT_WINTERS_ADDITIVE', mae: 1.5, weeklyTotal: 40,
  forecast: [{ date: '2026-11-16', point: 8, lower: 5, upper: 11 }], historyWorkingDays: 25, historicalTransactionCount: 200,
  historyStartDate: '2026-10-01', historyEndDate: '2026-11-13', generatedAt: new Date().toISOString(),
  ...over,
});
const get = (token, officeId) => call(forecastRoute, req('GET', `/analytics/forecast?officeId=${officeId}`, { token }));

describe('forecast route, stored run & R1 freshness/UUID RBAC', () => {
  it('serves today\'s valid stored run with stale: false and history list', async () => {
    await saveForecastRun(env.ds, run(OFFICE_A));
    const res = await get(tokens.officeHeadA, OFFICE_A);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'SUCCESS');
    assert.equal(res.body.stale, false);
    assert.equal(res.body.weeklyTotal, 40);
    assert.equal(res.body.forecast[0].lower, 5);
    assert.ok(Array.isArray(res.body.history));
    assert.ok(res.body.history.every((h) => typeof h.date === 'string' && Number.isInteger(h.count)));
  });

  it('authorizes uppercase and lowercase own-office UUIDs consistently while forbidding other offices', async () => {
    await saveForecastRun(env.ds, run(OFFICE_B));
    await saveForecastRun(env.ds, run(OFFICE_A));

    assert.equal((await get(tokens.officeHeadA, OFFICE_A)).status, 200);
    assert.equal((await get(tokens.officeHeadA, OFFICE_A.toUpperCase())).status, 200);
    assert.equal((await get(tokens.officeStaffA, OFFICE_A.toUpperCase())).status, 200);

    assert.equal((await get(tokens.officeHeadA, OFFICE_B)).status, 403);
    assert.equal((await get(tokens.officeHeadA, OFFICE_B.toUpperCase())).status, 403);
    assert.equal((await get(tokens.officeStaffA, OFFICE_B)).status, 403);
    assert.equal((await get(tokens.executive, OFFICE_B.toUpperCase())).status, 200);
    assert.equal((await get(tokens.superAdmin, OFFICE_A.toUpperCase())).status, 200);
  });

  it('validates freshness by Manila calendar date and recomputes old or ERROR runs', async () => {
    // 2026-11-10T15:59:00Z = 2026-11-10 23:59 Manila; 2026-11-10T16:01:00Z = 2026-11-11 00:01 Manila (next day!)
    assert.equal(isForecastFreshForToday(
      { status: 'SUCCESS', generated_at: '2026-11-10T15:59:00Z' },
      new Date('2026-11-10T16:01:00Z'),
    ), false);
    assert.equal(isForecastFreshForToday(
      { status: 'SUCCESS', generated_at: '2026-11-10T16:00:00Z' },
      new Date('2026-11-11T15:59:00Z'),
    ), true);
    assert.equal(isForecastFreshForToday(
      { status: 'ERROR', generated_at: '2026-11-11T02:00:00Z' },
      new Date('2026-11-11T03:00:00Z'),
    ), false);

    // Save an old stored run (3 days old) and verify readForecast recomputes & persists today's run
    await saveForecastRun(env.ds, run(OFFICE_A, {
      generatedAt: '2026-11-08T02:00:00Z',
      weeklyTotal: 99,
      forecast: [{ date: '2026-11-09', point: 20, lower: 15, upper: 25 }],
    }));
    const workingCal = {
      isWorkingDay: async (date) => {
        const dow = new Date(`${date}T12:00:00+08:00`).getUTCDay();
        return dow !== 0 && dow !== 6;
      },
      nextWorkingDays: async (_from, count) => Array.from({ length: count }, (_, i) => `2026-11-${12 + i}`),
    };
    const recomputed = await readForecast(env.ds, {
      officeId: OFFICE_A,
      calendarClient: workingCal,
      now: new Date('2026-11-11T04:00:00Z'),
    });
    assert.equal(recomputed.stale, false);
    assert.equal(recomputed.generatedAt, '2026-11-11T04:00:00.000Z');
    assert.equal(recomputed.status, 'SUCCESS');
    assert.notEqual(recomputed.forecast[0].date, '2026-11-09');
  });

  it('does not silently present old data as today when Core fails: marks fallback stale: true, and 503s if none exists', async () => {
    const failingCal = {
      isWorkingDay: async () => { throw new CoreCalendarError('Core 503'); },
      nextWorkingDays: async () => { throw new CoreCalendarError('Core 503'); },
    };

    // Without any prior stored run -> 503 FORECAST_CALENDAR_UNAVAILABLE
    await assert.rejects(
      () => readForecast(env.ds, { officeId: OFFICE_A, calendarClient: failingCal, now: new Date('2026-11-11T04:00:00Z') }),
      (err) => err?.status === 503 && err?.code === 'FORECAST_CALENDAR_UNAVAILABLE',
    );

    // With an outdated non-error stored run -> explicit stale: true fallback with empty history
    await saveForecastRun(env.ds, run(OFFICE_A, {
      generatedAt: '2026-11-08T02:00:00Z',
      weeklyTotal: 42,
    }));
    const staleFallback = await readForecast(env.ds, {
      officeId: OFFICE_A,
      calendarClient: failingCal,
      now: new Date('2026-11-11T04:00:00Z'),
    });
    assert.equal(staleFallback.stale, true);
    assert.equal(staleFallback.weeklyTotal, 42);
    assert.equal(staleFallback.generatedAt, '2026-11-08T02:00:00.000Z');
    assert.deepEqual(staleFallback.history, []);

    // With Core failing via live route and today's ERROR row only -> 503 instead of returning ERROR row as valid
    await env.ds.query('DELETE FROM forecast_runs');
    await saveForecastRun(env.ds, run(OFFICE_A, {
      status: 'ERROR',
      errorCode: 'INTERNAL_ERROR',
      forecast: [],
      weeklyTotal: 0,
    }));
    const prevCoreUrl = process.env.CORE_URL;
    process.env.CORE_URL = 'http://127.0.0.1:1'; // unreachable port
    try {
      const res = await get(tokens.officeHeadA, OFFICE_A);
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'FORECAST_CALENDAR_UNAVAILABLE');
    } finally {
      process.env.CORE_URL = prevCoreUrl;
    }
  });

  it('retrain route remains Super Admin only and normalizes uppercase UUIDs', async () => {
    const denied = await call(retrainRoute, req('POST', '/analytics/forecast/retrain', {
      token: tokens.officeHeadA,
      body: { officeId: OFFICE_A },
    }));
    assert.equal(denied.status, 403);

    const ok = await call(retrainRoute, req('POST', '/analytics/forecast/retrain', {
      token: tokens.superAdmin,
      body: { officeId: OFFICE_A.toUpperCase() },
    }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.scope.officeId, OFFICE_A.toLowerCase());
    assert.equal(ok.body.stale, false);
  });

  it('returns TOO_FEW for service-level forecasts under 40 transactions and excludes holidays/weekends in buildHistorySeries', async () => {
    const fakeCalendar = {
      isWorkingDay: async (date) => {
        const dow = new Date(`${date}T12:00:00+08:00`).getUTCDay();
        if (dow === 0 || dow === 6) return false;
        // Treat the 1st of any month as a synthetic holiday to confirm non-working days are excluded
        return !date.endsWith('-01');
      },
    };
    await insertTransaction(env.ds, { office_id: OFFICE_A, service_id: SERVICE_A });
    const tooFew = await computeForecast(env.ds, fakeCalendar, { officeId: OFFICE_A, serviceId: SERVICE_A });
    assert.equal(tooFew.status, 'TOO_FEW');
    assert.equal(tooFew.errorCode, 'TOO_FEW');

    const series = await buildHistorySeries(env.ds, fakeCalendar, { officeId: OFFICE_A, maxWorkingDays: 10 });
    assert.equal(series.dates.length, 10);
    for (const d of series.dates) {
      const dow = new Date(`${d}T12:00:00+08:00`).getUTCDay();
      assert.notEqual(dow, 0);
      assert.notEqual(dow, 6);
      assert.ok(!d.endsWith('-01'));
    }
    assert.equal(series.counts.length, 10);
    assert.ok(series.counts.every((c) => Number.isInteger(c) && c >= 0));
  });
});
