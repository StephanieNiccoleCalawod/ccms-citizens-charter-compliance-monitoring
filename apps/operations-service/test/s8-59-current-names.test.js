import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withCurrentAccountNames } from '../src/modules/transaction/current-names.js';

describe('S8-59 current names from Identity', () => {
  it('looks up each account once and preserves stored fallback data', async () => {
    const rows = [{ started_by: 'account-a', started_by_name: 'Stored mock' }, { started_by: 'account-a', started_by_name: 'Stored mock' }];
    let calls = 0;
    const identity = { starterOf: async () => { calls += 1; return { name: 'Current mock' }; } };
    const result = await withCurrentAccountNames(rows, { identity });
    assert.equal(calls, 1);
    assert.ok(result.every((row) => row.started_by_name === 'Current mock'));
    assert.equal(rows[0].started_by_name, 'Stored mock');
  });
  it('uses the fallback for failed and missing accounts without adding fields to restricted views', async () => {
    const rows = [{ started_by: 'account-a', started_by_name: 'Stored mock' }, { transaction_id: 'restricted' }];
    const identity = { starterOf: async () => { throw new Error('offline'); } };
    assert.deepEqual(await withCurrentAccountNames(rows, { identity }), rows);
  });
  it('resolves report names using person account IDs', async () => {
    const identity = { starterOf: async () => ({ name: 'Current mock' }) };
    const [row] = await withCurrentAccountNames([{ person_id: 'account-a', person_name: 'Stored mock' }], {
      identity, idField: 'person_id', nameField: 'person_name',
    });
    assert.equal(row.person_name, 'Current mock');
  });
});
