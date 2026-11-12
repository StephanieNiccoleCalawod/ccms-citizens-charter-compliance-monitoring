// CC032: the public list of active offices for the complaint form (no login, only id, code and name).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { ROLES, setDataSource, setDefaultVerifier } from 'ccms-shared';
import { createTestDatabase, createTestKeys } from 'ccms-shared/testing';
import { GET as publicOffices } from '../src/app/api/public/offices/route.js';
import { POST as postOffice } from '../src/app/api/offices/route.js';
import { PATCH as deactivateRoute } from '../src/app/api/offices/[id]/deactivate/route.js';
import { afterSync } from '../src/lib/after-sync.js';
import { entities } from '../src/lib/entities/index.js';
import { updateCatalogueSettings } from '../src/lib/catalogue/settings.js';

let testDb;
let admin;
before(async () => {
  process.env.SERVICE_KEY = 'test-service-key-0123456789';
  const keys = await createTestKeys();
  setDefaultVerifier(keys.verifier);
  testDb = await createTestDatabase({ entities, afterSync });
  setDataSource(testDb.dataSource);
  await updateCatalogueSettings(testDb.dataSource, { id: randomUUID(), role: ROLES.SUPER_ADMIN }, { institution_code: 'PUP' });
  admin = await keys.signToken({ role: ROLES.SUPER_ADMIN, full_name: 'Sam Admin' });
});
after(async () => { setDataSource(null); await testDb?.drop(); });

const post = (body) => postOffice(new Request('http://localhost/api/offices', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify(body) }));

describe('GET /public/offices', () => {
  it('needs no token and lists only active offices, with only id, code and name', async () => {
    const a = await (await post({ office_abbr: 'REG', office_name: 'Registrar' })).json();
    const b = await (await post({ office_abbr: 'OSA', office_name: 'Student Affairs' })).json();
    const id = (x) => x.office?.office_id ?? x.office_id;
    const off = await deactivateRoute(new Request('http://localhost/api/offices/x/deactivate', { method: 'PATCH', headers: { authorization: `Bearer ${admin}` } }), { params: Promise.resolve({ id: id(b) }) });
    assert.ok(off.status < 300, `deactivate answered ${off.status}`);
    const res = await publicOffices(new Request('http://localhost/api/public/offices', { headers: { 'x-forwarded-for': '203.0.113.50' } }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((o) => o.office_id), [id(a)]);
    assert.deepEqual(Object.keys(body.items[0]).sort(), ['office_code', 'office_id', 'office_name']);
  });
});
