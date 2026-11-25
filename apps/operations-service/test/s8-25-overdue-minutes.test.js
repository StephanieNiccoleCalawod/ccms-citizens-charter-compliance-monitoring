// S8-25: late-risk items carry limit, elapsed and overdue working minutes, so the screen can say "Overdue by 2 h 15 min (working time)".
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { readLateRisk } from '../src/modules/analytics/late-risk.js';

const now = new Date('2026-11-24T04:00:00Z');
const officeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = { role: ROLES.OFFICE_HEAD, officeId };

function read(used, limit) {
  const row = { transaction_id: 'tx-1', tracking_no: 'T1', service_name: 'Service', office_id: officeId, service_id: 'service',
    service_classification: 'SIMPLE', started_by: 'staff', status: 'IN_PROGRESS', started_at: '2026-11-23T01:00:00Z', closed_at: null,
    standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, held_minutes: 0, hold_started_at: null };
  const db = { query: async (sql) => {
    if (sql.includes('FROM late_risk_runs')) return [];
    if (sql.startsWith('SELECT scored_at')) return [];
    if (sql.includes('FROM transactions t')) return [row];
    if (sql.startsWith('INSERT INTO late_risk_score_cache')) return [];
    assert.fail(`Unexpected query: ${sql}`);
  } };
  const timing = { baseUrl: 'http://core/api', key: 'test', fetcher: async () => new Response(JSON.stringify({ items: [{ at: now.toISOString(), used, limit, onHold: false, workingDays: ['2026-11-23'] }] })) };
  return readLateRisk(db, officeId, actor, { now, timing });
}

test('an item past its limit reports how many working minutes past', async () => {
  const [item] = (await read(435, 300)).items;
  assert.equal(item.limit_minutes, 300);
  assert.equal(item.elapsed_working_minutes, 435);
  assert.equal(item.overdue_working_minutes, 135);
  assert.equal(item.working_minutes_left, 0);
});

test('an item inside its limit reports zero overdue and the minutes it has used', async () => {
  const [item] = (await read(120, 300)).items;
  assert.equal(item.overdue_working_minutes, 0);
  assert.equal(item.elapsed_working_minutes, 120);
  assert.equal(item.working_minutes_left, 180);
});
