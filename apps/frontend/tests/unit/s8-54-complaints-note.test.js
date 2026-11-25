import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPLAINTS_LINKED_NOTE, COMPLAINTS_NOTE, complaintsNote, peopleRows } from '../../src/lib/ui/people-report.js';

test('S8-54 the note under the people report follows what the server could count', () => {
  assert.equal(complaintsNote({ totals: { linked_complaints: null } }), COMPLAINTS_NOTE);
  assert.equal(complaintsNote({ totals: { linked_complaints: 0 } }), COMPLAINTS_LINKED_NOTE);
  assert.equal(complaintsNote({ totals: { linked_complaints: 4 } }), COMPLAINTS_LINKED_NOTE);
});
test('S8-54 a counted zero shows as 0 and an unknown count as a dash', () => {
  const rows = peopleRows({ scope: 'person', items: [{ person_name: 'Ana', linked_complaints: 0 }, { person_name: 'Ben', linked_complaints: null }], totals: {} });
  assert.deepEqual(rows.map((r) => r.complaints), ['0', '-']);
});
