import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { currentRiskNames } from '../src/modules/analytics/late-risk.js';
const items = [{ transaction_id: 't', started_by: 'a', probability: 0.6 }];
const db = { query: async () => [{ transaction_id: 't', started_by: 'a', started_by_name: 'Stored mock' }] };
const user = { id: 'a', role: ROLES.OFFICE_STAFF, officeId: 'o' };
test('cached risk labels refresh without changing scores or stored input', async () => {
  const result = await currentRiskNames(db, items, 'o', user, { identity: { starterOf: async () => ({ name: 'Current mock' }) } });
  assert.equal(result[0].started_by_name, 'Current mock');
  assert.equal(result[0].probability, 0.6);
  assert.equal(items[0].started_by_name, undefined);
});
test('risk labels keep the stored fallback on Identity failure', async () => {
  const result = await currentRiskNames(db, items, 'o', user, { identity: { starterOf: async () => { throw Error('offline'); } } });
  assert.equal(result[0].started_by_name, 'Stored mock');
});
test('risk labels remain hidden from Executives and other staff records', async () => {
  const forbiddenDb = { query: async () => { throw Error('must not query'); } };
  for (const viewer of [{ role: ROLES.EXECUTIVE }, { id: 'other', role: ROLES.OFFICE_STAFF, officeId: 'o' }]) {
    const result = await currentRiskNames(forbiddenDb, [{ ...items[0], started_by_name: 'Stored mock' }], 'o', viewer);
    assert.equal(result[0].started_by_name, undefined);
  }
});
