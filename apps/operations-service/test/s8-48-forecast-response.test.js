// S8-48 / CC038: backend response fields for dates, accuracy and insufficient history.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeForecast, formatForecastResult, formatStoredRun } from '../src/lib/forecast/forecast-service.js';

const officeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date('2026-11-24T04:00:00Z');
const forecastDates = ['2026-11-24', '2026-11-25', '2026-11-28', '2026-12-01', '2026-12-02'];
const points = forecastDates.map((date, i) => ({ date, point: i + 10, lower: i + 8, upper: i + 13 }));

test('S8-48 stored response keeps every calendar date and converts decimal MAE to a number, including zero', () => {
  for (const mae of ['0.6000', '0.0000']) {
    const response = formatStoredRun({
      office_id: officeId, status: 'SUCCESS', selected_model: 'HOLT_WINTERS_ADDITIVE', mae,
      forecast_payload: points, weekly_total: 60, history_working_days: 30,
      generated_at: now.toISOString(),
    });
    assert.equal(response.model.mae, Number(mae));
    assert.deepEqual(response.forecast.map((p) => p.date), forecastDates);
    assert.deepEqual(response.forecast, points);
    assert.equal(response.weeklyTotal, response.forecast.reduce((sum, p) => sum + p.point, 0));
  }
});

test('S8-48 computed response includes numeric MAE and uses the five dates returned by Core', async () => {
  const db = { query: async () => [{ working_date: '2026-11-20', cnt: 12 }] };
  const calendar = {
    isWorkingDay: async (date) => {
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    },
    nextWorkingDays: async (_from, count, scope) => {
      assert.equal(count, 5);
      assert.equal(scope, officeId);
      return forecastDates;
    },
  };
  const response = formatForecastResult(await computeForecast(db, calendar, { officeId, now }));
  assert.equal(response.status, 'SUCCESS');
  assert.ok(Number.isFinite(response.model.mae) && response.model.mae >= 0);
  assert.deepEqual(response.forecast.map((p) => p.date), forecastDates);
  for (const point of response.forecast) {
    assert.ok(Number.isInteger(point.point) && point.point >= 0);
    assert.ok(Number.isInteger(point.lower) && point.lower >= 0);
    assert.ok(Number.isInteger(point.upper) && point.upper >= point.point);
  }
  assert.equal(response.weeklyTotal, response.forecast.reduce((sum, p) => sum + p.point, 0));
});

test('S8-48 fewer than 20 working days returns the not-enough-history state and no invented forecast', async () => {
  const db = { query: async () => [] };
  const calendar = { isWorkingDay: async () => false };
  const response = formatForecastResult(await computeForecast(db, calendar, { officeId, now }));
  assert.equal(response.status, 'NOT_ENOUGH_HISTORY');
  assert.equal(response.errorCode, 'NOT_ENOUGH_HISTORY');
  assert.match(response.errorMessage, /Not enough history yet/);
  assert.equal(response.model.mae, null);
  assert.deepEqual(response.forecast, []);
});

test('S8-48 services below 40 transactions return TOO_FEW and no accuracy value', async () => {
  const db = { query: async () => [{ cnt: 39 }] };
  const response = formatForecastResult(await computeForecast(db, {}, { officeId, serviceId: officeId, now }));
  assert.equal(response.status, 'TOO_FEW');
  assert.equal(response.model.mae, null);
  assert.deepEqual(response.forecast, []);
});
