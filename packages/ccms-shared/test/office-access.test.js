// S8-23 / F8-02: the office boundary used by every office-scoped route (changed in dd9ed36: case-insensitive, and no office means denied).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROLES } from '../src/roles.js';
import { assertOfficeAccess, officeFilter } from '../src/permissions.js';

const OFFICE = '0b6f5f0e-1111-4222-8333-444455556666';
const OTHER = '0b6f5f0e-9999-4222-8333-444455556666';
const denied = (fn) => assert.throws(fn, (e) => e.status === 403 || e.statusCode === 403 || /forbidden/i.test(String(e.code ?? e.message)));

describe('assertOfficeAccess', () => {
  for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
    it(`${role}: own office passes, also when the letters differ in case`, () => {
      assertOfficeAccess({ role, officeId: OFFICE }, OFFICE);
      assertOfficeAccess({ role, officeId: OFFICE.toUpperCase() }, OFFICE);
    });
    it(`${role}: another office is refused`, () => denied(() => assertOfficeAccess({ role, officeId: OFFICE }, OTHER)));
    it(`${role}: a resource with no office is refused`, () => { denied(() => assertOfficeAccess({ role, officeId: OFFICE }, null)); denied(() => assertOfficeAccess({ role, officeId: OFFICE }, undefined)); });
    it(`${role}: a caller with no office is refused, even for a resource with no office`, () => { denied(() => assertOfficeAccess({ role, officeId: null }, OFFICE)); denied(() => assertOfficeAccess({ role }, null)); });
  }
  it('Super Admin and Executive are not limited to one office', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE]) { assertOfficeAccess({ role, officeId: null }, OTHER); assertOfficeAccess({ role, officeId: null }, null); }
  });
  it('officeFilter limits office roles to their office and nobody else', () => {
    assert.equal(officeFilter({ role: ROLES.OFFICE_HEAD, officeId: OFFICE }), OFFICE);
    assert.equal(officeFilter({ role: ROLES.OFFICE_STAFF, officeId: OFFICE }), OFFICE);
    assert.equal(officeFilter({ role: ROLES.SUPER_ADMIN, officeId: null }), null);
    assert.equal(officeFilter({ role: ROLES.EXECUTIVE, officeId: null }), null);
  });
});
