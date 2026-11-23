import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { hasUnnamedStaff, staffRows } from '../../src/lib/ui/kpi-home.js';

describe('S8-17 per-staff rows without a name', () => {
  const groups = [{ user_id: 'a', received: 2 }, { user_id: 'b', received: 1 }];
  it('a known name is used and the row counts as named', () => {
    const rows = staffRows(groups, new Map([['a', 'Ana Cruz']]));
    assert.equal(rows.find((r) => r.id === 'a').name, 'Ana Cruz');
    assert.equal(rows.find((r) => r.id === 'a').named, true);
  });
  it('an unknown person is "Staff member" and the table is told to explain it', () => {
    const rows = staffRows(groups, new Map([['a', 'Ana Cruz']]));
    assert.equal(rows.find((r) => r.id === 'b').name, 'Staff member');
    assert.equal(hasUnnamedStaff(rows), true);
  });
  it('no note when every name is known', () => {
    assert.equal(hasUnnamedStaff(staffRows(groups, new Map([['a', 'A'], ['b', 'B']]))), false);
    assert.equal(hasUnnamedStaff([]), false);
  });
});
