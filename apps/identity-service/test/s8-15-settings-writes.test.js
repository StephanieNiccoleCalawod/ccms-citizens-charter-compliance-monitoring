// S8-15: Identity's settings. The permission switches and the session policy are Super Admin only: Office Head, Office Staff and Executive get 403 and no token gets 401,
// the session policy cannot be changed from the screen at all, a Super Admin's switch change is audited, and no reply carries a secret.
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import * as sessionPolicyRoute from '../src/app/api/session-policy/route.js';
import { GET as switchesGet, PUT as switchesPut } from '../src/app/api/permission-switches/route.js';
import { outboxEvents, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());

const as = async (role) => tokenFor(await seedAccount(ds, { role }));
const SECRET = /password|secret|private_?key|token|hash/i;

describe('S8-15 Identity settings are Super Admin only', () => {
  it('the session policy is read-only for the Super Admin and refused for everyone else', async () => {
    assert.deepEqual(Object.keys(sessionPolicyRoute).filter((k) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(k)), [], 'there is no way to change it here');
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      assert.equal((await sessionPolicyRoute.GET(req('GET', '/session-policy', { token: await as(role) }))).status, 403, role);
    }
    assert.equal((await sessionPolicyRoute.GET(req('GET', '/session-policy'))).status, 401);
    const ok = await sessionPolicyRoute.GET(req('GET', '/session-policy', { token: await as(ROLES.SUPER_ADMIN) }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const view = await ok.json();
    assert.deepEqual(Object.keys(view).sort(), ['applies_to', 'enforced', 'roles'], 'only the policy');
    for (const row of view.roles) assert.deepEqual(Object.keys(row).sort(), ['absolute_minutes', 'idle_minutes', 'role', 'role_label'], 'only limits, no secret');
  });

  it('permission switches: Office Head, Office Staff and Executive get 403 on a change and nothing is audited', async () => {
    const before = (await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length;
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const r = await switchesPut(req('PUT', '/permission-switches', { token: await as(role), body: { switches: { STAFF_BACKDATE: true } } }));
      assert.equal(r.status, 403, role);
      assert.ok(!SECRET.test(await r.text()), 'the refusal carries no secret');
    }
    assert.equal((await switchesPut(req('PUT', '/permission-switches', { body: { switches: { STAFF_BACKDATE: true } } }))).status, 401);
    assert.equal((await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length, before);
    const view = await (await switchesGet(req('GET', '/permission-switches', { token: await as(ROLES.SUPER_ADMIN) }))).json();
    assert.ok(view.switches.every((s) => s.enabled === false), 'no switch moved');
  });
});

describe('S8-15 a Super Admin switch change is audited and shows no secret', () => {
  it('saves, audits and replies with the switches only', async () => {
    const token = await as(ROLES.SUPER_ADMIN);
    const before = (await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length;
    const saved = await switchesPut(req('PUT', '/permission-switches', { token, body: { switches: { STAFF_BACKDATE: true } } }));
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    assert.ok(!SECRET.test(JSON.stringify((await saved.json()).switches)), 'no secret in the reply');
    assert.ok((await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length > before, 'the change is in the audit trail');
    await ds.query('UPDATE permission_switches SET enabled = false');
  });
});
