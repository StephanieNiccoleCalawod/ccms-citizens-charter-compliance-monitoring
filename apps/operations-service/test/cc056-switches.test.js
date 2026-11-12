// CC056: Office Staff hold/resume and backdating follow the Super Admin's switches; Office Heads and Super Admins do not.
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { createSwitchGate } from 'ccms-shared';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { POST as holdRoute } from '../src/app/api/transactions/[id]/hold/route.js';
import { POST as resumeRoute } from '../src/app/api/transactions/[id]/resume/route.js';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { setSwitchGate } from '../src/modules/transaction/switches.js';
import { NOT_IN_REGISTRY, SERVICE_A, USERS, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
  await env.ds.query('UPDATE transaction_settings SET hold_enabled = true');
  Object.assign(switchState, { STAFF_BACKDATE: false, STAFF_HOLD_RESUME: false });
});
afterEach(() => Object.assign(switchState, { STAFF_BACKDATE: true, STAFF_HOLD_RESUME: true }));

// One open transaction per staff account, so tests that need a second one use another staff account's record (heads/admins may act on it).
const mine = (over = {}) => insertTransaction(env.ds, { started_by: USERS.staffA, ...over });
const theirs = (over = {}) => insertTransaction(env.ds, { started_by: USERS.staffA2, ...over });
const hold = (id, token = tokens.officeStaffA) => call(holdRoute, req('POST', `/transactions/${id}/hold`, { token, body: { reason: 'Waiting for the signed form' } }), ctx(id));
const resume = (id, token = tokens.officeStaffA) => call(resumeRoute, req('POST', `/transactions/${id}/resume`, { token }), ctx(id));
const body = (over = {}) => ({ service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true, ...over });
const start = (over = {}, token = tokens.officeStaffA) => call(startRoute, req('POST', '/transactions', { token, body: body(over) }));
const complete = (id, payload, token = tokens.officeStaffA) => call(completeRoute, req('POST', `/transactions/${id}/complete`, { token, body: payload }), ctx(id));
const statusOf = async (id) => (await env.ds.query('SELECT status FROM transactions WHERE transaction_id = $1', [id]))[0].status;
const past = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

describe('CC056 hold and resume', () => {
  it('staff with the switch off: hold and resume are 403 SWITCH_OFF and nothing changes', async () => {
    const t = await mine();
    const r = await hold(t.transaction_id);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SWITCH_OFF');
    assert.equal(await statusOf(t.transaction_id), 'IN_PROGRESS');
    await env.ds.query(`UPDATE transactions SET status = 'ON_HOLD', hold_started_at = $2 WHERE transaction_id = $1`, [t.transaction_id, new Date(Date.now() - 600_000).toISOString()]);
    const held = t;
    const r2 = await resume(held.transaction_id);
    assert.equal(r2.status, 403);
    assert.equal(r2.body.error.code, 'SWITCH_OFF');
    assert.equal(await statusOf(held.transaction_id), 'ON_HOLD');
  });

  it('staff with the switch on: hold works', async () => {
    switchState.STAFF_HOLD_RESUME = true;
    const t = await mine();
    assert.equal((await hold(t.transaction_id)).status, 200);
    assert.equal(await statusOf(t.transaction_id), 'ON_HOLD');
  });

  it('the Office Head and Super Admin can hold with every switch off', async () => {
    const a = await mine();
    assert.equal((await hold(a.transaction_id, tokens.officeHeadA)).status, 200);
    const b = await theirs();
    assert.equal((await hold(b.transaction_id, tokens.superAdmin)).status, 200);
  });

  it('turning the switch off applies to the staff member’s next request (no new sign-in)', async () => {
    switchState.STAFF_HOLD_RESUME = true;
    const a = await mine();
    assert.equal((await hold(a.transaction_id)).status, 200);
    switchState.STAFF_HOLD_RESUME = false;
    assert.equal((await resume(a.transaction_id)).status, 403);
  });
});

describe('CC056 backdating', () => {
  it('staff with the switch off cannot start with a supplied start time (403) and no record is created', async () => {
    const r = await start({ started_at: past(), backdate_reason: 'Catalogue outage' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SWITCH_OFF');
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM transactions'))[0].n, 0);
  });

  it('staff with the switch off cannot complete with a supplied end time, but a normal completion still works', async () => {
    const t = await mine({ started_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    const r = await complete(t.transaction_id, { ended_at: past(), backdate_reason: 'Forgot to click' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SWITCH_OFF');
    assert.equal(await statusOf(t.transaction_id), 'IN_PROGRESS');
    assert.notEqual((await complete(t.transaction_id, {})).status, 403, 'a completion without a supplied time is not gated');
  });

  it('staff with the switch on can backdate a start', async () => {
    switchState.STAFF_BACKDATE = true;
    const r = await start({ started_at: past(), backdate_reason: 'Catalogue outage' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.is_backdated, true);
  });

  it('an ordinary start is never gated; the Office Head can backdate with every switch off', async () => {
    assert.equal((await start({})).status, 201);
    const r = await start({ started_at: past(), backdate_reason: 'Catalogue outage' }, tokens.officeHeadA);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
});

describe('CC056 the real gate against an unreachable Identity', () => {
  it('denies staff (switch off) when Identity cannot be reached', async () => {
    setSwitchGate(createSwitchGate({ env: { IDENTITY_URL: 'http://127.0.0.1:9', SERVICE_KEY: 'k' }, timeoutMs: 300 }));
    try {
      const t = await mine();
      const r = await hold(t.transaction_id);
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'SWITCH_OFF');
      assert.equal((await hold((await theirs()).transaction_id, tokens.officeHeadA)).status, 200, 'heads are not decided by a switch');
    } finally {
      setSwitchGate({ all: async () => ({ ...switchState }), isEnabled: async (k) => switchState[k] === true, reset() {} });
    }
  });
});
