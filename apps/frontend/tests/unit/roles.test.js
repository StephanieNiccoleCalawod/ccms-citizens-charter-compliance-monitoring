import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROLE_LIST } from 'ccms-shared/roles';
import { isRecognizedRole, userFromClaims } from '../../src/lib/auth/guards.js';

const base = { sub: 'u1', employee_no: 'E-1', full_name: 'Test User', office_id: null };

describe('role claim validation (uses the shared ROLE_LIST)', () => {
  it('accepts every supported role and keeps the user fields', () => {
    assert.ok(ROLE_LIST.length >= 4);
    for (const role of ROLE_LIST) {
      assert.equal(isRecognizedRole(role), true, role);
      assert.deepEqual(userFromClaims({ ...base, role, office_id: 'o1' }), { id: 'u1', employeeNo: 'E-1', fullName: 'Test User', role, officeId: 'o1' });
    }
  });

  it('returns null when the role is missing', () => {
    assert.equal(userFromClaims({ ...base }), null);
    assert.equal(userFromClaims({ ...base, role: null }), null);
    assert.equal(userFromClaims({ ...base, role: '' }), null);
  });

  it('returns null for a role that is not a string', () => {
    for (const role of [1, true, ['super_admin'], { role: 'super_admin' }]) assert.equal(userFromClaims({ ...base, role }), null, JSON.stringify(role));
  });

  it('returns null for an unknown role', () => {
    for (const role of ['citizen', 'admin', 'root', 'super admin', ' super_admin']) assert.equal(userFromClaims({ ...base, role }), null, role);
  });

  it('returns null for a wrong-case role', () => {
    for (const role of ROLE_LIST) {
      assert.equal(userFromClaims({ ...base, role: role.toUpperCase() }), null, role.toUpperCase());
      assert.equal(userFromClaims({ ...base, role: role[0].toUpperCase() + role.slice(1) }), null);
    }
  });

  it('returns null for missing claims', () => {
    assert.equal(userFromClaims(null), null);
    assert.equal(userFromClaims(undefined), null);
  });
});
