// CC047: client types per service (spec 8.1). Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { ROLES, normaliseAllowedClientTypes, readAllowedClientTypes, setDataSource, setDefaultVerifier } from 'ccms-shared';
import { createTestDatabase, createTestKeys } from 'ccms-shared/testing';
import { POST as postOffice } from '../src/app/api/offices/route.js';
import { GET as listRoute, POST as postService } from '../src/app/api/services/route.js';
import { PUT as putService } from '../src/app/api/services/[id]/route.js';
import { GET as asOfRoute } from '../src/app/api/services/[id]/standard/route.js';
import { GET as publicDetail } from '../src/app/api/public/services/[id]/route.js';
import { GET as seedCatalogue } from '../src/app/api/internal/seed-catalogue/route.js';
import { addDays, manilaToday } from '../src/lib/catalogue/catalogue-rules.js';
import { afterSync } from '../src/lib/after-sync.js';
import { entities } from '../src/lib/entities/index.js';
import { updateCatalogueSettings } from '../src/lib/catalogue/settings.js';
import { Cc047AllowedClientTypes1794528000000 } from '../migrations/1794528000000-Cc047AllowedClientTypes.js';

const SERVICE_KEY = 'test-service-key-0123456789';
const ALL = ['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL'];
let testDb;
let ds;
let keys;
let token;
let office;
let n = 0;

const req = (method, path, { body, headers, auth = true } = {}) => new Request(`http://localhost/api${path}`, {
  method,
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const call = async (handler, request, context) => {
  const response = await handler(request, context);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
function body(over = {}) {
  n += 1;
  const code = `C${String(n).padStart(3, '0')}`;
  return {
    office_id: office.office_id, service_abbr: code, service_name: `Eligibility Service ${code}`, classification: 'SIMPLE',
    service_scope: 'EXTERNAL', transaction_types: ['G2C'],
    standard: { duration_days: 0, duration_hours: 0, duration_minutes: 7, effective_from: addDays(manilaToday(), -30) },
    ...over,
  };
}
const create = (over) => call(postService, req('POST', '/services', { body: body(over) }));

before(async () => {
  process.env.SERVICE_KEY = SERVICE_KEY;
  keys = await createTestKeys();
  setDefaultVerifier(keys.verifier);
  testDb = await createTestDatabase({ entities, afterSync });
  ds = testDb.dataSource;
  setDataSource(ds);
  await updateCatalogueSettings(ds, { id: randomUUID(), role: ROLES.SUPER_ADMIN }, { institution_code: 'PUP' });
  token = await keys.signToken({ role: ROLES.SUPER_ADMIN, full_name: 'Sam Admin' });
  const response = await postOffice(req('POST', '/offices', { body: { office_abbr: 'REG', office_name: 'Registrar' } }));
  office = (await response.json()).office;
});
after(async () => {
  setDataSource(null);
  await testDb?.drop();
});

describe('CC047 shared contract', () => {
  it('normalises order and duplicates, refuses empty, null and unknown values', () => {
    assert.deepEqual(normaliseAllowedClientTypes(['EXTERNAL', 'STUDENT', 'STUDENT']).value, ['STUDENT', 'EXTERNAL']);
    for (const bad of [[], null, 'STUDENT', [null], ['STUDENT', null], ['VISITOR'], [1]]) {
      assert.ok(normaliseAllowedClientTypes(bad).error, JSON.stringify(bad));
    }
  });
  it('treats a missing field from an older Core as all four, and a malformed one as an error (never a bypass)', () => {
    assert.deepEqual(readAllowedClientTypes(undefined), { value: ALL, legacy: true });
    assert.ok(readAllowedClientTypes(null).error);
    assert.ok(readAllowedClientTypes([]).error);
    assert.ok(readAllowedClientTypes(['NOPE']).error);
  });
});

describe('CC047 Core storage and API', () => {
  it('defaults a new service to all four types and returns them on the authenticated DTO and the standard lookup', async () => {
    const created = await create();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.service.allowed_client_types, ALL);
    const lookup = await call(asOfRoute, req('GET', `/services/${created.body.service.service_id}/standard`, { auth: false, headers: { 'x-service-key': SERVICE_KEY } }), ctx(created.body.service.service_id));
    assert.equal(lookup.status, 200);
    assert.deepEqual(lookup.body.allowed_client_types, ALL);
  });

  it('stores a normalised subset and validates create payloads', async () => {
    const created = await create({ allowed_client_types: ['ALUMNI', 'STUDENT', 'ALUMNI'] });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.service.allowed_client_types, ['STUDENT', 'ALUMNI']);
    for (const bad of [[], ['X'], [null], 'STUDENT', null]) {
      const refused = await create({ allowed_client_types: bad });
      assert.equal(refused.status, 400, JSON.stringify(bad));
      assert.ok(refused.body.error.details.allowed_client_types);
    }
  });

  it('keeps the saved value when an edit omits the field and changes it when sent', async () => {
    const { body: { service } } = await create({ allowed_client_types: ['STUDENT'] });
    const edit = (over) => call(putService, req('PUT', `/services/${service.service_id}`, { body: {
      office_id: office.office_id, service_name: service.service_name, classification: 'SIMPLE', service_scope: 'EXTERNAL',
      transaction_types: ['G2C'], ...over,
    } }), ctx(service.service_id));
    const kept = await edit({ fees: 'PHP 10' });
    assert.equal(kept.status, 200);
    assert.deepEqual(kept.body.service.allowed_client_types, ['STUDENT']);
    const changed = await edit({ allowed_client_types: ['EXTERNAL', 'EMPLOYEE'] });
    assert.deepEqual(changed.body.service.allowed_client_types, ['EMPLOYEE', 'EXTERNAL']);
    assert.equal((await edit({ allowed_client_types: [] })).status, 400);
  });

  it('enforces the invariant in storage, whatever writes the row', async () => {
    const { body: { service } } = await create();
    for (const value of ['{}', '{STUDENT,NULL}', '{VISITOR}', '{{STUDENT}}']) {
      await assert.rejects(ds.query('UPDATE services SET allowed_client_types = $1::text[] WHERE service_id = $2', [value, service.service_id]), /allowed_client_types_check|violates/, value);
    }
  });

  it('leaves the public catalogue view unchanged', async () => {
    const { body: { service } } = await create({ allowed_client_types: ['STUDENT'] });
    const response = await call(publicDetail, new Request(`http://localhost/api/public/services/${service.service_id}`, { headers: { 'x-forwarded-for': '10.9.9.9' } }), ctx(service.service_id));
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.body).includes('allowed_client_types'), false);
  });

  it('lists the field on the authenticated catalogue list', async () => {
    const listed = await call(listRoute, req('GET', '/services?page_size=100'));
    assert.ok(listed.body.items.every((item) => Array.isArray(item.allowed_client_types) && item.allowed_client_types.length >= 1));
  });

  it('serves the seed catalogue to the service key only', async () => {
    assert.equal((await call(seedCatalogue, req('GET', '/internal/seed-catalogue'))).status, 401);
    const ok = await call(seedCatalogue, req('GET', '/internal/seed-catalogue', { auth: false, headers: { 'x-service-key': SERVICE_KEY } }));
    assert.equal(ok.status, 200);
    assert.ok(ok.body.services.every((s) => Array.isArray(s.allowed_client_types)));
    assert.ok(Array.isArray(ok.body.standards) && Array.isArray(ok.body.offices));
  });
});

describe('CC047 migration rollback guard', () => {
  it('refuses to revert while a service is narrowed, unless explicitly allowed', async () => {
    await create({ allowed_client_types: ['STUDENT'] });
    const runner = ds.createQueryRunner();
    try {
      await assert.rejects(new Cc047AllowedClientTypes1794528000000().down(runner), /discard the client-type restriction/);
      const [{ exists }] = await runner.query("SELECT count(*)::int AS exists FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'allowed_client_types'");
      assert.equal(exists, 1);
    } finally {
      await runner.release();
    }
  });
});
