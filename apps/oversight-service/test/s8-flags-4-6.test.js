import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancellationFlags, holdFlags } from '../src/modules/insights/case-flags.js';

test('flag 4: only requests held more than one working day (480 working minutes)', () => {
  const rows = [{ transaction_id: 'a', tracking_no: 'A', held_minutes: 481 }, { transaction_id: 'b', tracking_no: 'B', held_minutes: 480 }, { transaction_id: 'c', tracking_no: 'C', held_minutes: 900 }, { transaction_id: 'd', held_minutes: null }];
  assert.deepEqual(holdFlags(rows).map((h) => h.transaction_id), ['c', 'a']);
});

const day = (n) => `2026-10-${String(n).padStart(2, '0')}T02:00:00Z`;
const make = (days, spike) => {
  const rows = [];
  for (let i = 1; i <= days; i += 1) {
    for (let k = 0; k < 4; k += 1) rows.push({ office_id: 'O', started_at: day(i), status: k === 0 && i % 2 ? 'CANCELLED' : 'COMPLETED' });
  }
  for (let k = 0; k < spike; k += 1) rows.push({ office_id: 'O', started_at: day(days), status: k % 2 ? 'AUTO_CLOSED' : 'CANCELLED' });
  return rows;
};
test('flag 6: a day with far more cancelled or auto-closed than usual, with 20+ working days', () => {
  const found = cancellationFlags(make(25, 6), { from: '2026-10-20', to: '2026-10-25' });
  assert.equal(found.length, 1);
  assert.equal(found[0].days.at(-1).day, '2026-10-25');
  assert.ok(found[0].days.at(-1).cancelled > found[0].usual_max);
});
test('flag 6: nothing under 20 working days, or when the day is as usual', () => {
  assert.deepEqual(cancellationFlags(make(19, 6), { from: '2026-10-01', to: '2026-10-19' }), []);
  assert.deepEqual(cancellationFlags(make(25, 0), { from: '2026-10-01', to: '2026-10-25' }), []);
});
