import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { hubGroups, hubHasItems } from '../../src/lib/ui/settings-hub.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';

const hrefs = (role) => hubGroups(role).flatMap((g) => g.links.map((l) => l.href));

describe('D8-20 Settings hub', () => {
  it('Super Admin reaches every setting from the hub', () => {
    assert.deepEqual(hrefs(ROLES.SUPER_ADMIN).sort(), ['/access', '/calendar', '/offices', '/settings/connected-systems', '/settings/notifications', '/settings/roles', '/settings/security', '/settings/transactions']);
  });
  it('holidays and suspensions and Accounts are not in the hub', () => {
    for (const role of Object.values(ROLES)) for (const h of hrefs(role)) assert.ok(!['/accounts', '/calendar?tab=holidays'].includes(h), h);
  });
  it('other roles see only read-only links they may open, never an admin page', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const asks = [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(role); // S8-52: they may also ask for access
      assert.deepEqual(hrefs(role).sort(), asks ? ['/access', '/calendar', '/settings/notifications', '/settings/transactions'] : ['/calendar', '/settings/transactions']);
      for (const g of hubGroups(role)) for (const l of g.links) assert.equal(l.readOnly, !['/access', '/settings/notifications'].includes(l.href));
    }
  });
  it('Settings is not a sidebar item: it lives in the account dropdown, shown only when the hub has something for the role', () => {
    for (const role of Object.values(ROLES)) assert.equal(appNavForRole(role).some((i) => i.href === '/settings'), false, role);
    assert.equal(hubHasItems('nobody'), false);
  });
});
