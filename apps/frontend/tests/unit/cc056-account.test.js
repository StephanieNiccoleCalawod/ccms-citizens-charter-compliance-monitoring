// CC056: My account and Roles and permissions (rules and source checks, not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { CAPABILITIES, SWITCH_KEYS, capabilitiesFor } from 'ccms-shared';
import { ROLES } from 'ccms-shared/roles';
import { changeMyPassword, getMe, getPermissionSwitches, savePermissionSwitches } from '../../src/lib/api/account.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { LAST_SIGN_IN_NONE, SWITCH_SCOPE_ALL, SWITCH_SCOPE_SPECIFIC, accessBadgeMeta, accessLabel, affectedRolesForSwitch, buildSwitchUpdate, countSwitchControlledRows, filterCapabilityRows, groupRows, isSwitchCell, isSwitchControlledRow, lastSignIn, myAccessLabel, passwordFormErrors, passwordServerErrors, roleMeta, summarizeCategories, switchChanges, switchOfficeIdsOf, switchScopeOf, switchScopeSummary, switchValues } from '../../src/lib/ui/account.js';
import { roleAllowsPast } from '../../src/lib/ui/backdate.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('CC056 calls', () => {
  it('go to Identity through the gateway with the right methods and bodies', async () => {
    const calls = [];
    const fetcher = async (path, options) => { calls.push([path, options]); return {}; };
    await getMe(fetcher);
    await changeMyPassword({ current: 'old-pass-123', next: 'new-pass-456' }, fetcher);
    await getPermissionSwitches(fetcher);
    await savePermissionSwitches({ STAFF_BACKDATE: true }, fetcher);
    await savePermissionSwitches({ STAFF_BACKDATE: { enabled: true, scope: 'SPECIFIC', office_ids: ['o1', 'o2'] } }, fetcher);
    assert.deepEqual(calls[0], ['/api/identity/me', undefined]);
    assert.deepEqual(calls[1], ['/api/identity/me/password', { method: 'PUT', body: { current_password: 'old-pass-123', new_password: 'new-pass-456' } }]);
    assert.deepEqual(calls[2], ['/api/identity/permission-switches', undefined]);
    assert.deepEqual(calls[3], ['/api/identity/permission-switches', { method: 'PUT', body: { switches: { STAFF_BACKDATE: true } } }]);
    assert.deepEqual(calls[4], ['/api/identity/permission-switches', { method: 'PUT', body: { switches: { STAFF_BACKDATE: { enabled: true, scope: 'SPECIFIC', office_ids: ['o1', 'o2'] } } } }]);
  });
});

describe('CC056 change password rules', () => {
  it('asks for every field and checks the match, the length and "different from current"', () => {
    assert.deepEqual(Object.keys(passwordFormErrors({ current: '', next: '', confirm: '' })).sort(), ['confirm', 'current', 'next']);
    assert.ok(passwordFormErrors({ current: 'a', next: 'short', confirm: 'short' }).next);
    assert.ok(passwordFormErrors({ current: 'same-password-1', next: 'same-password-1', confirm: 'same-password-1' }).next);
    assert.equal(passwordFormErrors({ current: 'a', next: 'long-enough-1', confirm: 'different-1' }).confirm, 'The two passwords do not match.');
    assert.deepEqual(passwordFormErrors({ current: 'old-password', next: 'long-enough-1', confirm: 'long-enough-1' }), {});
  });
  it('maps the server’s field messages onto the form', () => {
    assert.deepEqual(passwordServerErrors({ current_password: 'x', new_password: 'y' }), { current: 'x', next: 'y' });
    assert.deepEqual(passwordServerErrors(undefined), {});
  });
});

describe('CC056 labels and switches', () => {
  it('words for every cell kind, and the switch state on "What I can do"', () => {
    assert.equal(accessLabel('own office'), 'Own office');
    assert.equal(accessLabel('no'), 'No');
    assert.match(accessLabel({ switch: 'STAFF_BACKDATE' }), /switch/i);
    assert.match(myAccessLabel({ access: 'no', switch_key: 'STAFF_BACKDATE', switch_on: false }), /^Off/);
    assert.match(myAccessLabel({ access: 'yes', switch_key: 'STAFF_BACKDATE', switch_on: true }), /^Yes/);
    assert.equal(myAccessLabel({ access: 'read only', switch_key: null }), 'Read only');
  });
  it('last sign-in shows a Manila date or says none is recorded', () => {
    assert.equal(lastSignIn(null), LAST_SIGN_IN_NONE);
    assert.match(lastSignIn('2026-11-10T06:05:00Z'), /2:05 PM/);
  });
  it('only the switches that changed are sent', () => {
    const saved = switchValues([{ key: 'A', enabled: false }, { key: 'B', enabled: true }]);
    assert.deepEqual(switchChanges(saved, { A: true, B: true }), { A: true });
    assert.deepEqual(switchChanges(saved, saved), {});
  });
  it('office scope helpers read saved scope/offices and build minimal PUT payloads', () => {
    assert.equal(switchScopeOf({ scope: 'SPECIFIC' }), SWITCH_SCOPE_SPECIFIC);
    assert.equal(switchScopeOf({ scope: 'ALL' }), SWITCH_SCOPE_ALL);
    assert.equal(switchScopeOf(null), SWITCH_SCOPE_ALL);
    assert.deepEqual(switchOfficeIdsOf({ scope: 'SPECIFIC', office_ids: ['B', 'a', 'b'] }), ['a', 'b']);
    assert.deepEqual(switchOfficeIdsOf({ scope: 'ALL', office_ids: ['a'] }), []);

    assert.equal(buildSwitchUpdate({ nextEnabled: true, scope: 'ALL', currentSwitch: { scope: 'ALL' } }), true);
    assert.equal(buildSwitchUpdate({ nextEnabled: false, scope: 'ALL', currentSwitch: { scope: 'ALL' } }), false);
    assert.deepEqual(
      buildSwitchUpdate({ nextEnabled: true, scope: 'SPECIFIC', officeIds: ['O2', 'o1'], currentSwitch: { scope: 'ALL' } }),
      { enabled: true, scope: 'SPECIFIC', office_ids: ['o1', 'o2'] },
    );
    assert.deepEqual(
      buildSwitchUpdate({ nextEnabled: true, scope: 'ALL', currentSwitch: { scope: 'SPECIFIC', office_ids: ['o1'] } }),
      { enabled: true, scope: 'ALL', office_ids: [] },
    );
    assert.deepEqual(
      buildSwitchUpdate({ nextEnabled: false, scope: 'SPECIFIC', officeIds: ['o1'], currentSwitch: { scope: 'SPECIFIC', office_ids: ['o1'] } }),
      { enabled: false, scope: 'ALL', office_ids: [] },
    );

    const summary = switchScopeSummary(
      { scope: 'SPECIFIC', office_ids: ['o1', 'o2'] },
      [{ office_id: 'o1', office_name: 'Registrar' }, { office_id: 'o2', office_name: 'OSAS' }],
    );
    assert.equal(summary.label, '2 offices');
    assert.match(summary.title, /Registrar, OSAS/);
    assert.equal(switchScopeSummary({ scope: 'ALL' }).label, 'All offices');
  });
  it('roleAllowsPast keeps Super Admin and Office Head open and reads office-scoped STAFF_BACKDATE for Office Staff', () => {
    assert.equal(roleAllowsPast(null, ROLES.SUPER_ADMIN), true);
    assert.equal(roleAllowsPast(null, ROLES.OFFICE_HEAD), true);
    assert.equal(roleAllowsPast(null, ROLES.EXECUTIVE), false);
    assert.equal(roleAllowsPast(null, ROLES.OFFICE_STAFF), false);
    assert.equal(roleAllowsPast({ what_i_can_do: [{ switch_key: 'STAFF_BACKDATE', switch_on: false }] }, ROLES.OFFICE_STAFF), false);
    assert.equal(roleAllowsPast({ what_i_can_do: [{ switch_key: 'STAFF_BACKDATE', switch_on: true }] }, ROLES.OFFICE_STAFF), true);
  });
  it('groups keep the order the rows come in', () => {
    const groups = groupRows(CAPABILITIES.map((c) => ({ key: c.key, group: c.group })));
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), CAPABILITIES.length);
    assert.equal(new Set(groups.map((g) => g.name)).size, groups.length);
  });
  it('the Office Staff switch rows are exactly the four switches', () => {
    const keys = capabilitiesFor(ROLES.OFFICE_STAFF, {}).map((c) => c.switchKey).filter(Boolean).sort();
    assert.deepEqual(keys, [...SWITCH_KEYS].sort());
  });
  it('summarizes actual module categories, counts switch-controlled rows, filters by category/query, and maps real access states', () => {
    const summary = summarizeCategories(CAPABILITIES);
    assert.equal(summary.total, CAPABILITIES.length);
    assert.deepEqual(summary.categories.map((c) => c.name), ['Administration', 'Reference', 'Transactions', 'Analytics', 'Reports', 'Complaints']);
    assert.equal(countSwitchControlledRows(CAPABILITIES), SWITCH_KEYS.length);
    assert.equal(isSwitchControlledRow(CAPABILITIES.find((c) => c.key === 'tx.hold')), true);
    assert.equal(isSwitchControlledRow(CAPABILITIES.find((c) => c.key === 'accounts')), false);

    const adminRows = filterCapabilityRows(CAPABILITIES, { category: 'Administration' });
    assert.equal(adminRows.every((r) => r.group === 'Administration'), true);
    const searchByKey = filterCapabilityRows(CAPABILITIES, { query: 'tx.backdate' });
    assert.deepEqual(searchByKey.map((r) => r.key), ['tx.backdate']);
    const searchByLabel = filterCapabilityRows(CAPABILITIES, { query: 'audit log' });
    assert.deepEqual(searchByLabel.map((r) => r.key), ['logs']);

    assert.equal(accessBadgeMeta('yes').kind, 'yes');
    assert.equal(accessBadgeMeta('own office').kind, 'own_office');
    assert.equal(accessBadgeMeta('own records').kind, 'own_records');
    assert.equal(accessBadgeMeta('read only').kind, 'read_only');
    assert.equal(accessBadgeMeta('no').kind, 'no');
    assert.equal(accessBadgeMeta({ switch: 'STAFF_HOLD_RESUME' }, { STAFF_HOLD_RESUME: false }).kind, 'switch_off');
    assert.equal(accessBadgeMeta({ switch: 'STAFF_HOLD_RESUME' }, { STAFF_HOLD_RESUME: true }).kind, 'switch_on');
    assert.equal(roleMeta(ROLES.SUPER_ADMIN).description, 'Full campus control');
    assert.equal(isSwitchCell({ switch: 'STAFF_HOLD_RESUME' }), true);
    assert.equal(isSwitchCell('yes'), false);
    const fakeMatrix = {
      roles: [
        { role: ROLES.SUPER_ADMIN, label: 'Super Admin' },
        { role: ROLES.OFFICE_STAFF, label: 'Office Staff' },
      ],
      rows: CAPABILITIES,
    };
    assert.deepEqual(affectedRolesForSwitch(fakeMatrix, 'STAFF_HOLD_RESUME').map((r) => r.role), [ROLES.OFFICE_STAFF]);
  });
});

describe('CC056 screens (source checks)', () => {
  it('Roles and permissions is reached only through the Account Settings sidebar (not the main sidebar), and stays Super Admin only', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) assert.ok(!appNavForRole(role).some((i) => i.href === '/settings/roles'), role);
    assert.match(read('src/app/settings/roles/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
  });
  it('My account is open to every role and is reached from the user menu', () => {
    assert.match(read('src/app/account/page.js'), /allowedRoles=\{ROLE_LIST\}/);
    assert.match(read('src/components/layout/AppShell.js'), /label: 'My account', href: '\/account'/);
  });
  it('the matrix renders interactive switches only on switch-controlled cells with Super Admin confirmation + persistence via page.js and PermissionSwitches', () => {
    const matrix = read('src/components/account/RolesMatrix.js');
    assert.match(matrix, /TableShell/);
    assert.match(matrix, /SearchInput/);
    assert.match(matrix, /customPlaceholder="Filter capabilities\.\.\."/);
    assert.match(matrix, /Highlight Switch-Controlled/);
    assert.match(matrix, /Access Scope Legend/);
    assert.match(matrix, /CAPABILITY \/ ACTION/);
    assert.match(matrix, /aria-expanded=\{!isCollapsed\}/);
    assert.match(matrix, /role="switch"/);
    assert.match(matrix, /showInteractiveSwitch/);
    assert.doesNotMatch(matrix, /savePermissionSwitches/);
    const page = read('src/app/settings/roles/page.js');
    assert.match(page, /<PermissionConfirmModal/);
    assert.match(page, /savePermissionSwitches\(\{ \[switchKey\]: payload \}\)/);
    assert.match(matrix, /roles-scope-\$\{switchKey\}/);
    const modal = read('src/components/account/PermissionConfirmModal.js');
    assert.match(modal, /<ConfirmDialog/);
    assert.match(modal, /<OfficeCheckboxList/);
    assert.match(modal, /Specific Office\(s\)/);
    assert.match(read('src/components/forms/OfficeCheckboxList.js'), /<Checkbox/);
    assert.doesNotMatch(read('src/app/settings/transactions/page.js'), /OfficeBackdate/);
    assert.match(read('src/components/transactions/StartTransactionForm.js'), /roleAllowsPast\(me, user\.role\)/);
    assert.ok(read('src/components/account/PermissionSwitches.js').includes('view.switches.map'));
  });
  it('the password form never shows a saved message before the server answers, and clears the passwords after', () => {
    const form = read('src/components/account/ChangePasswordForm.js');
    assert.ok(form.indexOf('await save(') < form.indexOf('notify.success('));
    assert.match(form, /setValues\(\{ current: '', next: '', confirm: '' \}\)/);
  });
});
