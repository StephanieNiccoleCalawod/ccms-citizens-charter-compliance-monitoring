// S8-52: GET /me lists the extra access a person holds right now, so the screens open what the server will allow. Only for Office Head and Office Staff.
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as meRoute } from '../src/app/api/me/route.js';
import { createRequest, decideRequest, listActiveGrants, listRequests } from '../src/lib/access-requests.js';
import { OFFICE_A, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());

const me = async (account) => (await meRoute(req('GET', '/me', { token: await tokenFor(account) }))).json();
const actor = (account, role) => ({ id: account.accountId, role, officeId: OFFICE_A });
const requestIdOf = async (account, key) => (await ds.query('SELECT request_id FROM access_requests WHERE account_id = $1 AND permission_key = $2', [account.accountId, key]))[0].request_id;

describe('S8-52 /me extra_access', () => {
  it('is empty for a person with no extra access, and for roles that cannot have any', async () => {
    for (const role of [ROLES.OFFICE_STAFF, ROLES.OFFICE_HEAD, ROLES.SUPER_ADMIN, ROLES.EXECUTIVE]) {
      assert.deepEqual((await me(await seedAccount(ds, { role }))).extra_access, [], role);
    }
  });

  it('lists a granted permission with its end date, and drops it once removed', async () => {
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A });
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    await createRequest(ds, actor(staff, ROLES.OFFICE_STAFF), { permission_key: 'EXPORT_CSV', reason: 'Monthly report for the Office Head' });
    assert.deepEqual((await me(staff)).extra_access, [], 'a request that is only waiting gives nothing');
    const endsOn = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await decideRequest(ds, actor(admin, ROLES.SUPER_ADMIN), await requestIdOf(staff, 'EXPORT_CSV'), { decision: 'GRANT', ends_on: endsOn });
    assert.deepEqual((await me(staff)).extra_access, [{ permission_key: 'EXPORT_CSV', ends_on: endsOn }]);
    await ds.query(`UPDATE account_permission_grants SET status = 'REVOKED' WHERE account_id = $1`, [staff.accountId]);
    assert.deepEqual((await me(staff)).extra_access, []);
  });

  it('the Active access list and the request list show the end date as YYYY-MM-DD, and flag a grant that ends within 7 days', async () => {
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A });
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    await createRequest(ds, actor(staff, ROLES.OFFICE_STAFF), { permission_key: 'VIEW_OFFICE_QUEUE', reason: 'Covering the counter' });
    const endsOn = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await decideRequest(ds, actor(admin, ROLES.SUPER_ADMIN), await requestIdOf(staff, 'VIEW_OFFICE_QUEUE'), { decision: 'GRANT', ends_on: endsOn });
    const mine = (await listActiveGrants(ds, actor(admin, ROLES.SUPER_ADMIN))).items.find((g) => g.account_id === staff.accountId);
    assert.equal(mine.ends_on, endsOn);
    assert.equal(mine.ends_soon, true);
    const request = (await listRequests(ds, actor(admin, ROLES.SUPER_ADMIN), {})).items.find((r) => r.permission_key === 'VIEW_OFFICE_QUEUE' && r.account_id === staff.accountId);
    assert.equal(request.ends_on, endsOn);
  });
});
