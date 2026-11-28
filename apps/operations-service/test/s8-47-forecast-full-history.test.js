// S8-47 / CC038: verify the API service returns every model input, including days before the last 20.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { addCalendarDays } from '../src/lib/forecast/calendar-client.js';
import { readForecast } from '../src/lib/forecast/forecast-service.js';

const officeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now = new Date('2026-11-23T04:00:00Z');
const isWorkingDay = async (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && date !== '2026-11-02';
};
const calendar = {
  isWorkingDay,
  async nextWorkingDays(from, count) {
    const dates = [];
    for (let date = addCalendarDays(from, 1); dates.length < count; date = addCalendarDays(date, 1)) {
      if (await isWorkingDay(date)) dates.push(date);
    }
    return dates;
  },
};

async function fixture(scopeService) {
  // Derive expected working dates independently of the aggregator, including a holiday and zero days.
  const dates = [];
  for (let date = '2026-08-25'; date < '2026-11-23'; date = addCalendarDays(date, 1)) {
    if (await isWorkingDay(date)) dates.push(date);
  }
  const history = dates.slice(-30).map((date, i) => ({ date, count: i % 4 === 0 ? 0 : i + 1 }));
  let stored = null;
  let writes = 0;
  const db = {
    async query(sql, params) {
      if (sql.includes('SELECT * FROM forecast_runs')) {
        assert.deepEqual(params, [officeId, scopeService]);
        return stored ? [stored] : [];
      }
      if (sql.includes('SELECT COUNT(*)::int')) {
        assert.deepEqual(params, [officeId, scopeService]);
        return [{ cnt: 1000 }];
      }
      if (sql.includes('AS working_date')) {
        assert.equal(params[0], officeId);
        assert.equal(params[3] ?? null, scopeService);
        // No transaction rows for zero-count days: the aggregator must retain them as zero.
        return history.filter(({ count }) => count > 0).map(({ date, count }) => ({ working_date: date, cnt: count }));
      }
      if (sql.includes('INSERT INTO forecast_runs')) {
        writes++;
        stored = {
          office_id: params[0], service_id: params[1], selected_model: params[2], mae: params[3],
          history_start_date: params[4], history_end_date: params[5], history_working_days: params[6],
          historical_transaction_count: params[7], forecast_payload: JSON.parse(params[8]),
          weekly_total: params[9], status: params[10], error_code: params[11], error_message: params[12],
          generated_at: params[13],
        };
        return [{ id: 'test-run' }];
      }
      assert.fail(`Unexpected database query: ${sql}`);
    },
  };
  return { db, history, writes: () => writes };
}

describe('S8-47 full forecast history response', () => {
  for (const scopeService of [null, serviceId]) {
    it(`returns all 30 model days and 5 forecast days on compute and stored reads (${scopeService ? 'service' : 'office'})`, async () => {
      const f = await fixture(scopeService);
      const options = { officeId, serviceId: scopeService, calendarClient: calendar, now };
      const computed = await readForecast(f.db, options);
      const cached = await readForecast(f.db, options);
      assert.equal(f.writes(), 1, 'the second read must use the stored run');
      for (const result of [computed, cached]) {
        assert.equal(result.status, 'SUCCESS');
        assert.equal(result.stale, false);
        assert.deepEqual(result.history, f.history);
        assert.equal(result.history.length, result.historyWorkingDays);
        assert.equal(result.history.length, 30);
        assert.equal(result.forecast.length, 5);
        assert.equal(result.history.length + result.forecast.length, 35);
        assert.equal(result.history[0].date, result.historyStartDate);
        assert.equal(result.history.at(-1).date, result.historyEndDate);
        assert.equal(result.historicalTransactionCount, f.history.reduce((sum, row) => sum + row.count, 0));
        assert.ok(result.history.some(({ count }) => count === 0));
        assert.ok(result.history.every(({ date }) => date !== '2026-11-02' && date < '2026-11-23'));
        assert.ok(result.forecast[0].date > result.history.at(-1).date);
      }
    });
  }
});
