// Sprint 6 TT1 (K17): service-key reads of an office's active staff and of an operator's role.
// Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as officeAccounts } from '../src/app/api/internal/office-accounts/route.js';
import { GET as operatorRoute } from '../src/app/api/internal/operators/[id]/route.js';
import { OFFICE_A, ctx, req, seedAccount, setupTestEnv } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
});
after(async () => env?.cleanup());

const keyed = () => ({ headers: { 'x-service-key': process.env.SERVICE_KEY } });
const read = async (response) => ({ status: response.status, body: await response.json() });

describe('GET /internal/office-accounts', () => {
  it('lists active Office Head and Office Staff of the office in account order, with no email or password data', async () => {
    const head = await seedAccount(env.ds, { role: ROLES.OFFICE_HEAD, officeId: OFFICE_A });
    const staff = await seedAccount(env.ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A });
    const inactive = await seedAccount(env.ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, active: false });
    const r = await read(await officeAccounts(req('GET', `/internal/office-accounts?office_id=${OFFICE_A}`, keyed())));
    assert.equal(r.status, 200);
    const ids = r.body.items.map((a) => a.account_id);
    assert.ok(ids.includes(head.accountId) && ids.includes(staff.accountId));
    assert.equal(ids.includes(inactive.accountId), false);
    assert.deepEqual(ids, [...ids].sort());
    assert.ok(r.body.items.every((a) => Object.keys(a).sort().join() === 'account_id,full_name,position,role'));
    assert.equal(JSON.stringify(r.body).includes('@'), false);
  });

  it('needs the service key and a valid office id', async () => {
    assert.equal((await officeAccounts(req('GET', `/internal/office-accounts?office_id=${OFFICE_A}`))).status, 401);
    assert.equal((await officeAccounts(req('GET', '/internal/office-accounts?office_id=nope', keyed()))).status, 400);
  });
});

describe('GET /internal/operators/:id', () => {
  it('confirms role and active state only, with the service key', async () => {
    const admin = await seedAccount(env.ds, { role: ROLES.SUPER_ADMIN, officeId: null });
    const r = await read(await operatorRoute(req('GET', `/internal/operators/${admin.accountId}`, keyed()), ctx(admin.accountId)));
    assert.deepEqual(r.body, { account_id: admin.accountId, role: ROLES.SUPER_ADMIN, is_active: true });
    assert.equal((await operatorRoute(req('GET', `/internal/operators/${admin.accountId}`), ctx(admin.accountId))).status, 401);
  });
});
