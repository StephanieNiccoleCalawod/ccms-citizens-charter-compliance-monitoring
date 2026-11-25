// S8-15: Operations' settings writes (transaction settings and counters). Super Admin only: Office Head, Office Staff and Executive get 403 and no token gets 401,
// a refused change leaves the data and the audit trail alone, a Super Admin's change is audited, and no reply carries a secret.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { GET as getSettings, PUT as putSettings } from '../src/app/api/settings/route.js';
import { POST as addCounter } from '../src/app/api/counters/route.js';
import { PUT as renameCounter } from '../src/app/api/counters/[id]/route.js';
import { PATCH as deactivateCounter } from '../src/app/api/counters/[id]/deactivate/route.js';
import { PATCH as reactivateCounter } from '../src/app/api/counters/[id]/reactivate/route.js';
import { OFFICE_A, call, ctx, req, resetData, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  await resetData(env.ds);
});
after(async () => env?.teardown());

const id = randomUUID();
const WRITES = [
  ['transaction settings', putSettings, 'PUT', '/settings', { hold_enabled: true, counters_enabled: true, version: 1 }],
  ['add counter', addCounter, 'POST', '/counters', { office_id: OFFICE_A, label: 'Window 9' }],
  ['rename counter', renameCounter, 'PUT', `/counters/${id}`, { label: 'Window 10' }, ctx(id)],
  ['deactivate counter', deactivateCounter, 'PATCH', `/counters/${id}/deactivate`, undefined, ctx(id)],
  ['reactivate counter', reactivateCounter, 'PATCH', `/counters/${id}/reactivate`, undefined, ctx(id)],
];
const auditCount = async () => Number((await env.ds.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n);
const settingsRow = async () => JSON.stringify(await env.ds.query('SELECT * FROM transaction_settings'));
const counterRows = async () => Number((await env.ds.query('SELECT count(*)::int AS n FROM counters'))[0].n);

describe('S8-15 Operations settings writes are Super Admin only', () => {
  for (const [name, handler, method, path, body, context] of WRITES) {
    it(`${name}: Office Head, Office Staff and Executive get 403 and no token gets 401`, async () => {
      const before = { audit: await auditCount(), settings: await settingsRow(), counters: await counterRows() };
      for (const token of [tokens.officeHeadA, tokens.officeStaffA, tokens.executive]) {
        const r = await call(handler, req(method, path, { token, body }), context);
        assert.equal(r.status, 403, `${name} with another role`);
        assert.ok(!/secret|password|token|key/i.test(JSON.stringify(r.body)), 'the refusal carries no secret');
      }
      assert.equal((await call(handler, req(method, path, { body }), context)).status, 401);
      assert.deepEqual({ audit: await auditCount(), settings: await settingsRow(), counters: await counterRows() }, before, 'nothing changed and nothing was audited');
    });
  }
});

describe('S8-15 a Super Admin change is audited and shows no secret', () => {
  it('transaction settings: saved, audited, and the reply holds only the settings', async () => {
    const current = (await call(getSettings, req('GET', '/settings', { token: tokens.superAdmin }))).body;
    const before = await auditCount();
    const saved = await call(putSettings, req('PUT', '/settings', { token: tokens.superAdmin, body: { ...current, hold_enabled: !current.hold_enabled } }));
    assert.equal(saved.status, 200);
    assert.ok((await auditCount()) > before, 'the change is in the audit trail');
    assert.ok(!/secret|password|token|api_?key|service_?key/i.test(JSON.stringify(saved.body)), 'no secret in the reply');
  });

  it('a counter: added, audited, and the reply holds only the counter', async () => {
    const before = await auditCount();
    const added = await call(addCounter, req('POST', '/counters', { token: tokens.superAdmin, body: { office_id: OFFICE_A, label: 'Window S815' } }));
    assert.equal(added.status, 201);
    assert.deepEqual(Object.keys(added.body).sort(), ['counter_id', 'is_active', 'label', 'office_id']);
    assert.ok((await auditCount()) > before);
  });
});
