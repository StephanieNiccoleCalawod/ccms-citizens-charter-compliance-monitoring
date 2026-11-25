import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GRANTABLE_KEYS, ROLES } from 'ccms-shared';
import { GRANTABLE, defaultEndsOn, endsOnBounds, endsOnError, requestError, canManageAccess, canRequestAccess, addDays } from '../../src/lib/ui/access.js';
import { hubGroups } from '../../src/lib/ui/settings-hub.js';

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

describe('S8-52 Request Access screens', () => {
  it('offers exactly the permissions the server allows', () => {
    assert.deepEqual(GRANTABLE.map((g) => g.key).sort(), [...GRANTABLE_KEYS].sort());
  });
  it('end date: 30 days first, 90 at most, never empty', () => {
    const today = '2026-11-25';
    assert.equal(defaultEndsOn(today), '2026-12-25');
    assert.deepEqual(endsOnBounds(today), { min: '2026-11-26', max: '2027-02-23' });
    assert.equal(endsOnError(defaultEndsOn(today), today), '');
    assert.match(endsOnError('', today), /cannot be left empty/);
    assert.match(endsOnError('2026-11-25', today), /after today/);
    assert.match(endsOnError('2027-02-24', today), /at most 90 days/);
    assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  });
  it('request form needs a choice and a reason', () => {
    assert.deepEqual(Object.keys(requestError({ permissionKey: '', reason: ' ' })).sort(), ['permissionKey', 'reason']);
    assert.deepEqual(requestError({ permissionKey: 'EXPORT_CSV', reason: 'For the audit' }), {});
  });
  it('who sees what', () => {
    assert.ok(canManageAccess(ROLES.SUPER_ADMIN) && !canManageAccess(ROLES.OFFICE_HEAD));
    assert.ok(canRequestAccess(ROLES.OFFICE_STAFF) && canRequestAccess(ROLES.OFFICE_HEAD) && !canRequestAccess(ROLES.EXECUTIVE));
  });
  it('the Settings hub links to it for the three roles', () => {
    const links = (role) => hubGroups(role).flatMap((g) => g.links).filter((l) => l.href === '/access');
    assert.equal(links(ROLES.SUPER_ADMIN).length, 1);
    assert.equal(links(ROLES.OFFICE_STAFF).length, 1);
    assert.equal(links(ROLES.EXECUTIVE).length, 0);
  });
  it('the page has Grant, Deny, Active access, Remove and the date hint', () => {
    const src = read('components/access/AccessPage.js');
    for (const t of ['Grant', 'Deny', 'Active access', 'Ends soon', 'Remove', 'DateHint']) assert.ok(src.includes(t), t);
  });
});
