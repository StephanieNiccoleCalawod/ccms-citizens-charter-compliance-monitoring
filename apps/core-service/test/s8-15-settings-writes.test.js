// S8-15: Core's settings writes. Every one is Super Admin only: Office Head, Office Staff and Executive get 403 and no token gets 401, a Super Admin's change is
// audited, and no reply or audit entry carries a secret (the machine key is shown once, in the reply that creates it, and nowhere else).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PUT as catalogueSettings, GET as catalogueSettingsGet } from '../src/app/api/catalogue-settings/route.js';
import { PUT as campusSchedule } from '../src/app/api/schedule/route.js';
import { POST as addException } from '../src/app/api/exceptions/route.js';
import { PUT as editException, DELETE as removeException } from '../src/app/api/exceptions/[id]/route.js';
import { POST as addTerm } from '../src/app/api/terms/route.js';
import { PUT as editTerm } from '../src/app/api/terms/[id]/route.js';
import { PUT as officeSchedule, DELETE as resetOfficeSchedule } from '../src/app/api/offices/[id]/schedule/route.js';
import { GET as listKeys, POST as issueKey } from '../src/app/api/machine-keys/route.js';
import { POST as revokeKey } from '../src/app/api/machine-keys/[id]/revoke/route.js';
import { POST as rotateKey } from '../src/app/api/machine-keys/[id]/rotate/route.js';
import { ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  await env.ds.query('INSERT INTO catalogue_settings (id) VALUES (1) ON CONFLICT DO NOTHING');
});
after(async () => env?.teardown());

const id = randomUUID();
const body = { institution_code: 'PUP', applies_to_enabled: true };
// [name, handler, method, path, body, route context]
const WRITES = [
  ['catalogue settings', catalogueSettings, 'PUT', '/catalogue-settings', body],
  ['campus working hours', campusSchedule, 'PUT', '/schedule', { days: [] }],
  ['add holiday or suspension', addException, 'POST', '/exceptions', { exception_date: '2026-12-25', exception_type: 'HOLIDAY', description: 'Christmas' }],
  ['edit holiday or suspension', editException, 'PUT', `/exceptions/${id}`, { description: 'x' }, ctx(id)],
  ['remove holiday or suspension', removeException, 'DELETE', `/exceptions/${id}`, undefined, ctx(id)],
  ['add academic term', addTerm, 'POST', '/terms', { name: 'Term' }],
  ['edit academic term', editTerm, 'PUT', `/terms/${id}`, { name: 'Term' }, ctx(id)],
  ['office working hours', officeSchedule, 'PUT', `/offices/${id}/schedule`, { days: [] }, ctx(id)],
  ['reset office working hours', resetOfficeSchedule, 'DELETE', `/offices/${id}/schedule`, undefined, ctx(id)],
  ['issue machine key', issueKey, 'POST', '/machine-keys', { caller: 'FMS', environment: 'test' }],
  ['revoke machine key', revokeKey, 'POST', `/machine-keys/${id}/revoke`, {}, ctx(id)],
  ['rotate machine key', rotateKey, 'POST', `/machine-keys/${id}/rotate`, {}, ctx(id)],
];
const send = (handler, method, path, payload, context, token) => handler(req(method, path, { token, body: payload }), context);
const auditCount = async () => Number((await env.ds.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n);

describe('S8-15 Core settings writes are Super Admin only', () => {
  for (const [name, handler, method, path, payload, context] of WRITES) {
    it(`${name}: Office Head, Office Staff and Executive get 403 and no token gets 401`, async () => {
      const before = await auditCount();
      for (const token of [tokens.officeHeadA, tokens.officeStaffA, tokens.executive]) {
        const response = await send(handler, method, path, payload, context, token);
        assert.equal(response.status, 403, `${name} with ${token.slice(0, 8)}`);
        const text = await response.text();
        assert.ok(!/ccms_mk_|key_hash|secret/i.test(text), 'the refusal carries no secret');
      }
      assert.equal((await send(handler, method, path, payload, context, undefined)).status, 401);
      // A refused change adds no audit entry, except Core's own "change rejected" record for the catalogue settings.
      if (name !== 'catalogue settings') assert.equal(await auditCount(), before);
    });
  }

  it('the machine key list is for the Super Admin only', async () => {
    for (const token of [tokens.officeHeadA, tokens.officeStaffA, tokens.executive]) assert.equal((await listKeys(req('GET', '/machine-keys', { token }))).status, 403);
    assert.equal((await listKeys(req('GET', '/machine-keys'))).status, 401);
  });
});

describe('S8-15 a Super Admin change is audited and shows no secret', () => {
  it('catalogue settings: saved, audited with before and after, and reading it back shows only the two settings', async () => {
    const before = await auditCount();
    const saved = await catalogueSettings(req('PUT', '/catalogue-settings', { token: tokens.superAdmin, body }));
    assert.equal(saved.status, 200);
    assert.ok((await auditCount()) > before, 'the change is in the audit trail');
    const read = await (await catalogueSettingsGet(req('GET', '/catalogue-settings', { token: tokens.superAdmin }))).json();
    assert.deepEqual(Object.keys(read.settings).sort(), ['applies_to_enabled', 'institution_code']);
  });

  it('a machine key: shown once when issued, never in the list or in the audit trail', async () => {
    const before = await auditCount();
    const issued = await issueKey(req('POST', '/machine-keys', { token: tokens.superAdmin, body: { caller: 'FMS', environment: 'test' } }));
    assert.equal(issued.status, 201);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    const created = await issued.json();
    const key = JSON.stringify(created).match(/ccms_mk_[0-9a-f]{12}\.[A-Za-z0-9_-]+/)?.[0];
    assert.ok(key, 'the key is in the reply that creates it');
    const secret = key.split('.')[1];
    assert.ok((await auditCount()) > before, 'issuing is audited');

    const list = await (await listKeys(req('GET', '/machine-keys', { token: tokens.superAdmin }))).text();
    assert.ok(!list.includes(secret) && !/key_hash|keyHash|"hash"/i.test(list), 'the list is metadata only');
    const audit = JSON.stringify(await env.ds.query('SELECT payload FROM audit_outbox'));
    assert.ok(!audit.includes(secret), 'the audit trail never holds the key');
    const stored = JSON.stringify(await env.ds.query('SELECT * FROM machine_keys'));
    assert.ok(!stored.includes(secret), 'only a hash of the secret is stored');
  });
});
