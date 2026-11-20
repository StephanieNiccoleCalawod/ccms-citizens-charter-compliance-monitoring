// The forecast history asks the calendar about its days in parallel rounds. The days chosen must be exactly what the old
// one-at-a-time walk chose, a failure must matter only if the walk reaches it, and a request must no longer wait for each day in turn.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildHistorySeries } from '../src/lib/forecast/aggregator.js';
import { addCalendarDays, manilaDate } from '../src/lib/forecast/calendar-client.js';

const NOW = new Date('2026-10-29T04:00:00Z');
const TODAY = manilaDate(NOW);
const weekday = (d) => new Date(`${d}T12:00:00+08:00`).getUTCDay();
const isWorking = (d) => weekday(d) !== 0 && weekday(d) !== 6 && d !== '2026-10-12';
const dataSource = { query: async () => [{ working_date: '2026-10-20', cnt: 5 }] };

// The previous algorithm, one question at a time, as the reference.
async function walkOneByOne(client, officeId, maxWorkingDays) {
  const found = [];
  for (let i = 0; i < 90; i++) {
    const d = addCalendarDays(TODAY, -(i + 1));
    if (await client.isWorkingDay(d, officeId)) found.push(d);
    if (found.length >= maxWorkingDays) break;
  }
  return found.sort();
}

describe('forecast history calendar lookups', () => {
  it('chooses exactly the days the one-at-a-time walk chose, for several history lengths', async () => {
    const client = { isWorkingDay: async (d) => isWorking(d) };
    for (const max of [1, 5, 20, 30, 60]) {
      const { dates } = await buildHistorySeries(dataSource, client, { officeId: 'o', maxWorkingDays: max, now: NOW });
      assert.deepEqual(dates, await walkOneByOne(client, 'o', max), `maxWorkingDays ${max}`);
    }
  });

  it('asks about a round of days at once instead of waiting for each answer in turn', async () => {
    let inFlight = 0;
    let peak = 0;
    const client = {
      isWorkingDay: async (d) => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return isWorking(d);
      },
    };
    await buildHistorySeries(dataSource, client, { officeId: 'o', maxWorkingDays: 30, now: NOW });
    assert.ok(peak > 10, `expected many concurrent questions, saw ${peak}`);
  });

  it('fails when the calendar fails on a day the walk needs, as before', async () => {
    const client = { isWorkingDay: async (d) => { if (d === addCalendarDays(TODAY, -3)) throw new Error('Core down'); return isWorking(d); } };
    await assert.rejects(() => buildHistorySeries(dataSource, client, { officeId: 'o', maxWorkingDays: 30, now: NOW }), /Core down/);
  });

  it('ignores a failure on a day after enough working days were already found', async () => {
    // Day 40 back is past the point where 5 working days are found (about a week), so the old walk never asked about it.
    const client = { isWorkingDay: async (d) => { if (d === addCalendarDays(TODAY, -40)) throw new Error('never asked'); return isWorking(d); } };
    const { dates } = await buildHistorySeries(dataSource, client, { officeId: 'o', maxWorkingDays: 5, now: NOW });
    assert.equal(dates.length, 5);
  });

  it('counts only the dates that were working days and keeps oldest-first order', async () => {
    const client = { isWorkingDay: async (d) => isWorking(d) };
    const { dates, counts, totalTransactions } = await buildHistorySeries(dataSource, client, { officeId: 'o', maxWorkingDays: 30, now: NOW });
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(dates.includes('2026-10-12'), false);
    assert.equal(counts[dates.indexOf('2026-10-20')], 5);
    assert.equal(totalTransactions, 5);
  });
});
