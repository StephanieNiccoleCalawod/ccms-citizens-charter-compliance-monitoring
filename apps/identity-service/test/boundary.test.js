import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { runBoundarySuite } from 'ccms-shared/testing';
import { GET as listRoute, POST as createRoute } from '../src/app/api/accounts/route.js';
import { GET as getRoute, PUT as putRoute } from '../src/app/api/accounts/[id]/route.js';
import { PATCH as deactivateRoute } from '../src/app/api/accounts/[id]/deactivate/route.js';
import { POST as resetRoute } from '../src/app/api/accounts/[id]/reset-password/route.js';
import { OFFICE_A, OFFICE_B, ctx, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

const SECRET = 'office-b-secret@pup.edu.ph';
let env;
let ds;
let accountA; // belongs to office A
let accountB; // belongs to office B (its email must never leak to office A callers)
const tokens = { superAdmin: null, executive: null, officeHeadA: null, officeStaffA: null };

before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  accountA = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, email: 'office-a-person@pup.edu.ph' });
  accountB = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_B, email: SECRET });
  tokens.superAdmin = await tokenFor(await seedAccount(ds, { role: ROLES.SUPER_ADMIN }));
  tokens.executive = await tokenFor(await seedAccount(ds, { role: ROLES.EXECUTIVE }));
  tokens.officeHeadA = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_HEAD, officeId: OFFICE_A }));
  tokens.officeStaffA = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A }));
});
after(() => env?.cleanup());

const target = (which) => (which === 'own' ? accountA : accountB);
const valid = () => ({
  employee_no: `B-${Math.random().toString(36).slice(2, 8)}`,
  full_name: 'Boundary Test',
  email: `b.${Math.random().toString(36).slice(2, 8)}@pup.edu.ph`,
  role: ROLES.EXECUTIVE,
});

// The reusable harness: later sprints add their endpoints to a suite like this one.
runBoundarySuite({
  name: 'identity',
  describe,
  it,
  assert,
  tokens,
  endpoints: [
    {
      name: 'GET /accounts/:id',
      write: false,
      officeScoped: true,
      otherOfficeMarker: SECRET,
      invoke: (token, which) => getRoute(req('GET', `/accounts/${target(which).accountId}`, { token }), ctx(target(which).accountId)),
    },
    { name: 'GET /accounts', superAdminOnly: true, invoke: (token) => listRoute(req('GET', '/accounts', { token })) },
    { name: 'POST /accounts', write: true, superAdminOnly: true, invoke: (token) => createRoute(req('POST', '/accounts', { token, body: { ...valid(), password: 'Password123!' } })) },
    {
      name: 'PUT /accounts/:id',
      write: true,
      superAdminOnly: true,
      invoke: (token, which) => putRoute(req('PUT', `/accounts/${target(which).accountId}`, { token, body: valid() }), ctx(target(which).accountId)),
    },
    {
      name: 'PATCH /accounts/:id/deactivate',
      write: true,
      superAdminOnly: true,
      invoke: (token, which) => deactivateRoute(req('PATCH', `/accounts/${target(which).accountId}/deactivate`, { token }), ctx(target(which).accountId)),
    },
    {
      name: 'POST /accounts/:id/reset-password',
      write: true,
      superAdminOnly: true,
      invoke: (token, which) => resetRoute(req('POST', `/accounts/${target(which).accountId}/reset-password`, { token }), ctx(target(which).accountId)),
    },
  ],
});

describe('CC004 office scoping details', () => {
  // The suite above lets Super Admin really change accountA/accountB, so these tests use fresh accounts.
  let own;
  let other;
  before(async () => {
    own = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, email: 'fresh-a@pup.edu.ph' });
    other = await seedAccount(ds, { role: ROLES.OFFICE_STAFF, officeId: OFFICE_B, email: SECRET.replace('office-b-secret', 'fresh-b-secret') });
  });

  it('AC1: an Office Staff token for office A never receives office B data, and an Office Head sees only their own office', async () => {
    const asHead = await getRoute(req('GET', `/accounts/${own.accountId}`, { token: tokens.officeHeadA }), ctx(own.accountId));
    assert.equal(asHead.status, 200);
    const denied = await getRoute(req('GET', `/accounts/${other.accountId}`, { token: tokens.officeHeadA }), ctx(other.accountId));
    assert.equal(denied.status, 403);
    assert.ok(!(await denied.text()).includes('fresh-b-secret'));
    // Office Staff have no account-lookup access at all.
    const staff = await getRoute(req('GET', `/accounts/${own.accountId}`, { token: tokens.officeStaffA }), ctx(own.accountId));
    assert.equal(staff.status, 403);
  });

  it('AC2: an Executive can read but any create, update or delete is 403', async () => {
    const read = await getRoute(req('GET', `/accounts/${other.accountId}`, { token: tokens.executive }), ctx(other.accountId));
    assert.equal(read.status, 200);
    const write = await putRoute(req('PUT', `/accounts/${other.accountId}`, { token: tokens.executive, body: valid() }), ctx(other.accountId));
    assert.equal(write.status, 403);
  });

  it('AC3: a Super Admin token reaches any office', async () => {
    for (const account of [own, other]) {
      const response = await getRoute(req('GET', `/accounts/${account.accountId}`, { token: tokens.superAdmin }), ctx(account.accountId));
      assert.equal(response.status, 200);
    }
  });

  it('a token cannot claim another office: the office comes from the signed claims', async () => {
    const tampered = tokens.officeHeadA.split('.');
    const claims = JSON.parse(Buffer.from(tampered[1], 'base64url'));
    claims.office_id = OFFICE_B;
    tampered[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const response = await getRoute(req('GET', `/accounts/${other.accountId}`, { token: tampered.join('.') }), ctx(other.accountId));
    assert.equal(response.status, 401);
  });
});
