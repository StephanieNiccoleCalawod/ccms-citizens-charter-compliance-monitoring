import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { assertOfficeBackdateAllowed, OFFICE_BACKDATE_DENIED } from '../src/modules/transaction/backdate-permission.js';

const officeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const core = (value) => ({ office: async () => ({ office_id: officeId, is_active: true, ...value }) });
test('S8-53 explicit permission is required for both Office Head and Office Staff', async () => {
  for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
    for (const value of [false, undefined]) await assert.rejects(
      assertOfficeBackdateAllowed(core({ allow_backdated_transactions: value }), { role }, officeId),
      (e) => e.status === 403 && e.message === OFFICE_BACKDATE_DENIED,
    );
    await assertOfficeBackdateAllowed(core({ allow_backdated_transactions: true }), { role }, officeId);
  }
});
test('S8-53 Super Admin bypasses office permission without a lookup', async () => {
  await assertOfficeBackdateAllowed({ office: () => assert.fail('Super Admin needs no permission lookup') }, { role: ROLES.SUPER_ADMIN }, officeId);
});
test('S8-53 failed/malformed/mismatched Core replies fail closed with 503', async () => {
  for (const adapter of [{ office: async () => { throw new Error('offline'); } }, core({ office_id: 'wrong' }),
    core({ allow_backdated_transactions: 'true' }), core({ is_active: null })]) {
    await assert.rejects(assertOfficeBackdateAllowed(adapter, { role: ROLES.OFFICE_HEAD }, officeId),
      (e) => e.status === 503 && e.code === 'OFFICE_BACKDATE_PERMISSION_UNAVAILABLE');
  }
});
test('S8-53 an inactive office cannot authorize non-admin backdating', async () => {
  await assert.rejects(assertOfficeBackdateAllowed(core({ is_active: false, allow_backdated_transactions: true }),
    { role: ROLES.OFFICE_HEAD }, officeId), (e) => e.status === 403);
});
