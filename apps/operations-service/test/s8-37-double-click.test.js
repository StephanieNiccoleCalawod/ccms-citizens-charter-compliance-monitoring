// S8-37 (BE check): a double click must never create two transactions or complete one twice. Both requests are sent at the same moment.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { NOT_IN_REGISTRY, SERVICE_A, USERS, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const body = () => ({ service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true });
const start = () => call(startRoute, req('POST', '/transactions', { token: tokens.officeStaffA, body: body() }));
const complete = (id) => call(completeRoute, req('POST', `/transactions/${id}/complete`, { token: tokens.officeStaffA }), ctx(id));
const count = async (sql) => (await env.ds.query(sql))[0].n;

describe('S8-37 double click safety', () => {
  it('two Start requests at the same moment create one transaction; the other is a clear 409', async () => {
    const results = await Promise.all([start(), start()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(results.find((r) => r.status === 409).body.error.code, 'OPEN_TRANSACTION_EXISTS');
    assert.equal(await count('SELECT count(*)::int AS n FROM transactions'), 1);
  });

  it('five Start requests at the same moment still create exactly one transaction and one tracking number', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, start));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => r.status === 201 || r.status === 409), results.map((r) => r.status).join(','));
    assert.equal(await count('SELECT count(*)::int AS n FROM transactions'), 1);
    assert.equal(await count('SELECT count(DISTINCT tracking_no)::int AS n FROM transactions'), 1);
  });

  it('two Complete requests at the same moment complete it once, and the other is refused with the current status', async () => {
    const t = await insertTransaction(env.ds, { started_by: USERS.staffA });
    const results = await Promise.all([complete(t.transaction_id), complete(t.transaction_id)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM transactions WHERE status = 'COMPLETED'`), 1);
    assert.equal(await count(`SELECT count(*)::int AS n FROM audit_outbox WHERE payload->>'action' = 'TRANSACTION_COMPLETED'`), 1);
  });
});
