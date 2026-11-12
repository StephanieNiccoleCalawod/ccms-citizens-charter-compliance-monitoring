// CC056: My account and Roles and permissions (rules and source checks, not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { CAPABILITIES, SWITCH_KEYS, capabilitiesFor } from 'ccms-shared';
import { ROLES } from 'ccms-shared/roles';
import { changeMyPassword, getMe, getPermissionSwitches, savePermissionSwitches } from '../../src/lib/api/account.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { LAST_SIGN_IN_NONE, accessLabel, groupRows, lastSignIn, myAccessLabel, passwordFormErrors, passwordServerErrors, switchChanges, switchValues } from '../../src/lib/ui/account.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('CC056 calls', () => {
  it('go to Identity through the gateway with the right methods and bodies', async () => {
    const calls = [];
    const fetcher = async (path, options) => { calls.push([path, options]); return {}; };
    await getMe(fetcher);
    await changeMyPassword({ current: 'old-pass-123', next: 'new-pass-456' }, fetcher);
    await getPermissionSwitches(fetcher);
    await savePermissionSwitches({ STAFF_BACKDATE: true }, fetcher);
    assert.deepEqual(calls[0], ['/api/identity/me', undefined]);
    assert.deepEqual(calls[1], ['/api/identity/me/password', { method: 'PUT', body: { current_password: 'old-pass-123', new_password: 'new-pass-456' } }]);
    assert.deepEqual(calls[2], ['/api/identity/permission-switches', undefined]);
    assert.deepEqual(calls[3], ['/api/identity/permission-switches', { method: 'PUT', body: { switches: { STAFF_BACKDATE: true } } }]);
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
  it('groups keep the order the rows come in', () => {
    const groups = groupRows(CAPABILITIES.map((c) => ({ key: c.key, group: c.group })));
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), CAPABILITIES.length);
    assert.equal(new Set(groups.map((g) => g.name)).size, groups.length);
  });
  it('the Office Staff switch rows are exactly the four switches', () => {
    const keys = capabilitiesFor(ROLES.OFFICE_STAFF, {}).map((c) => c.switchKey).filter(Boolean).sort();
    assert.deepEqual(keys, [...SWITCH_KEYS].sort());
  });
});

describe('CC056 screens (source checks)', () => {
  it('Roles and permissions is in the Super Admin menu only', () => {
    assert.ok(appNavForRole(ROLES.SUPER_ADMIN).some((i) => i.href === '/settings/roles'));
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) assert.ok(!appNavForRole(role).some((i) => i.href === '/settings/roles'), role);
    assert.match(read('src/app/settings/roles/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
  });
  it('My account is open to every role and is reached from the user menu', () => {
    assert.match(read('src/app/account/page.js'), /allowedRoles=\{ROLE_LIST\}/);
    assert.match(read('src/components/layout/AppShell.js'), /label: 'My account', href: '\/account'/);
  });
  it('the matrix is a shared table, read-only, and the only controls on the page are the four switches', () => {
    const matrix = read('src/components/account/RolesMatrix.js');
    assert.match(matrix, /TableShell/);
    assert.ok(!/<input|<button|onChange/.test(matrix));
    assert.ok(read('src/components/account/PermissionSwitches.js').includes('view.switches.map'));
  });
  it('the password form never shows a saved message before the server answers, and clears the passwords after', () => {
    const form = read('src/components/account/ChangePasswordForm.js');
    assert.ok(form.indexOf('await save(') < form.indexOf('notify.success('));
    assert.match(form, /setValues\(\{ current: '', next: '', confirm: '' \}\)/);
  });
});
