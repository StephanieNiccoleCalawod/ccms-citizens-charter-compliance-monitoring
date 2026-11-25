import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ROLES, setGrantGate } from 'ccms-shared';
import { assertOfficeBackdateAllowed } from '../src/modules/transaction/backdate-permission.js';

const OFFICE = '22222222-2222-4222-8222-222222222222';
const staff = { id: '11111111-1111-4111-8111-111111111111', role: ROLES.OFFICE_STAFF, officeId: OFFICE };
const closed = { office: async () => ({ office_id: OFFICE, is_active: true, allow_backdated_transactions: false }) };
const gate = (yes) => ({ has: async (_u, key) => yes && key === 'RECORD_PAST_TRANSACTIONS' });

describe('S8-52 granted permission "Record past transactions"', () => {
  afterEach(() => setGrantGate(null));
  it('lets the person record past transactions in their own office although the office setting is off', async () => {
    setGrantGate(gate(true));
    await assertOfficeBackdateAllowed(closed, staff, OFFICE);
  });
  it('does not work for another office', async () => {
    setGrantGate(gate(true));
    await assert.rejects(assertOfficeBackdateAllowed({ office: async () => ({ office_id: '33333333-3333-4333-8333-333333333333', is_active: true, allow_backdated_transactions: false }) }, staff, '33333333-3333-4333-8333-333333333333'), (e) => e.status === 403);
  });
  it('without a grant the office setting still decides (403)', async () => {
    setGrantGate(gate(false));
    await assert.rejects(assertOfficeBackdateAllowed(closed, staff, OFFICE), (e) => e.status === 403 && e.code === 'OFFICE_BACKDATE_NOT_ALLOWED');
  });
});
