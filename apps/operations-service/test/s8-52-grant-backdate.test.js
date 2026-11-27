import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { setGrantGate } from 'ccms-shared';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { NOT_IN_REGISTRY, OFFICE_A, SERVICE_A, SERVICE_B, USERS, at, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
  switchState.STAFF_BACKDATE = false;
});
afterEach(() => {
  setGrantGate(null);
  switchState.STAFF_BACKDATE = true;
});

const iso = (date, time) => `${date}T${time}:00+08:00`;
const gate = (yes, grantedOffice = OFFICE_A) => ({
  has: async (user, key) => yes && key === 'RECORD_PAST_TRANSACTIONS' && String(user?.officeId ?? '').toLowerCase() === grantedOffice.toLowerCase(),
});

describe('S8-52 granted permission "Record past transactions"', () => {
  it('lets Office Staff record past transactions in their own office even while STAFF_BACKDATE is off', async () => {
    setGrantGate(gate(true));
    const started = await call(startRoute, req('POST', '/transactions', {
      token: tokens.officeStaffA,
      body: { service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true, started_at: iso('2026-10-06', '10:00'), backdate_reason: 'Granted access' },
    }));
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const row = await insertTransaction(env.ds, { started_by: USERS.staffA2, started_at: new Date(at('2026-10-06', '10:00')) });
    const completed = await call(completeRoute, req('POST', `/transactions/${row.transaction_id}/complete`, {
      token: tokens.officeStaffA2,
      body: { ended_at: iso('2026-10-09', '18:00'), backdate_reason: 'Granted access' },
    }), ctx(row.transaction_id));
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
  });

  it('does not work for another office', async () => {
    setGrantGate(gate(true, OFFICE_A));
    const denied = await call(startRoute, req('POST', '/transactions', {
      token: tokens.officeStaffA,
      body: { service_id: SERVICE_B, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true, started_at: iso('2026-10-06', '10:00'), backdate_reason: 'Cross office' },
    }));
    assert.equal(denied.status, 403);
  });

  it('without a grant, STAFF_BACKDATE switch decides (403 SWITCH_OFF)', async () => {
    setGrantGate(gate(false));
    const denied = await call(startRoute, req('POST', '/transactions', {
      token: tokens.officeStaffA,
      body: { service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true, started_at: iso('2026-10-06', '10:00'), backdate_reason: 'No grant' },
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'SWITCH_OFF');
  });
});
