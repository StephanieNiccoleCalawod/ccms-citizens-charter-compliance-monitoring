// S8-13 (FE): one role-aware Settings hub that links to the existing screens. No new settings backend, no second copy of a setting.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { appNavForRole, settingsNav } from '../../src/lib/auth/permissions.js';
import { ACCESS_LABEL, SETTINGS_GROUPS, settingsHubForRole } from '../../src/lib/ui/settings-hub.js';

const here = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const read = (path) => readFileSync(here(path), 'utf8');
const pageFor = (href) => `src/app${href.split(/[?#]/)[0].replace(/\/$/, '')}/page.js`;
const itemsOf = (role, options) => settingsHubForRole(role, options).flatMap((g) => g.items);
const ids = (role, options) => itemsOf(role, options).map((i) => i.id);

describe('what each role sees (AC1, AC3)', () => {
  it('the Super Admin sees every group and every setting (Clerk only while it is switched on)', () => {
    assert.deepEqual(settingsHubForRole(ROLES.SUPER_ADMIN).map((g) => g.id), ['general', 'transactions', 'calendar', 'access', 'integrations']);
    assert.deepEqual(ids(ROLES.SUPER_ADMIN), ['offices', 'transaction-settings', 'working-hours', 'holidays', 'terms', 'roles', 'accounts', 'connected-systems']);
    assert.deepEqual(ids(ROLES.SUPER_ADMIN, { clerk: true }), ['offices', 'transaction-settings', 'working-hours', 'holidays', 'terms', 'roles', 'accounts', 'clerk', 'connected-systems']);
  });

  it('every other role sees only the read-only items it may open: transactions and the calendar, never offices, roles, accounts or integrations', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      assert.deepEqual(settingsHubForRole(role).map((g) => g.id), ['transactions', 'calendar'], role);
      assert.deepEqual(ids(role), ['transaction-settings', 'working-hours', 'holidays', 'terms'], role);
      assert.ok(itemsOf(role).every((i) => i.access === 'view'), `${role}: nothing they cannot change is offered as changeable`);
      assert.ok(!ids(role, { clerk: true }).includes('clerk'), role);
    }
  });

  it('"Can change" is only ever offered to the Super Admin; the Academic terms and Connected systems are read-only for everyone', () => {
    for (const role of ROLE_LIST) for (const item of itemsOf(role, { clerk: true })) assert.equal(item.access === 'edit', role === ROLES.SUPER_ADMIN && !['terms', 'connected-systems'].includes(item.id), `${role}/${item.id}`);
    assert.deepEqual({ ...ACCESS_LABEL }, { edit: 'Can change', view: 'View only' });
  });

  it('an unknown role sees nothing', () => {
    assert.deepEqual(settingsHubForRole('not_a_role'), []);
    assert.equal(settingsNav('not_a_role'), null);
  });

  it('every group has a title and a description, and every item a label, a description and a link', () => {
    for (const group of SETTINGS_GROUPS) {
      assert.ok(group.title && group.description, group.id);
      for (const item of group.items) assert.ok(item.label && item.description && item.href.startsWith('/'), item.id);
    }
  });
});

describe('two clicks or fewer, and every link opens a screen that exists (AC1, AC4)', () => {
  it('Settings is in every role\'s menu (click one), and each setting is one link from it (click two)', () => {
    for (const role of ROLE_LIST) {
      const item = appNavForRole(role).find((i) => i.href === '/settings');
      assert.ok(item, role);
      assert.equal(item.label, 'Settings');
      assert.equal(item.section, role === ROLES.SUPER_ADMIN ? 'Administration' : 'Reference');
      assert.equal(new Set(appNavForRole(role).map((i) => i.href)).size, appNavForRole(role).length, `${role}: no duplicate menu entry`);
    }
  });

  it('every link points at a page that is on disk, and the old addresses are all still there', () => {
    for (const group of SETTINGS_GROUPS) for (const item of group.items) assert.ok(existsSync(here(pageFor(item.href))), `${item.id}: ${item.href}`);
    for (const old of ['/settings', '/settings/roles', '/settings/clerk-access', '/settings/transactions', '/calendar', '/accounts', '/offices']) assert.ok(existsSync(here(pageFor(old))), old);
    assert.match(read('src/app/settings/clerk-access/page.js'), /router\.replace\('\/accounts\?tab=clerk'\)/, 'the old Clerk address still goes to Accounts');
  });

  it('the pages that only a Super Admin may open are exactly the items only a Super Admin is shown', () => {
    for (const href of ['/offices', '/accounts', '/settings/roles']) assert.match(read(pageFor(href)), /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/, href);
    assert.doesNotMatch(read('src/app/settings/transactions/page.js'), /allowedRoles=/, 'Transaction settings is readable by every role, as before');
    for (const group of SETTINGS_GROUPS) for (const item of group.items) {
      const guarded = /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/.test(existsSync(here(pageFor(item.href))) ? read(pageFor(item.href)) : '');
      if (guarded) assert.deepEqual([...item.roles], [ROLES.SUPER_ADMIN], item.id);
    }
  });

  it('the calendar links open the tab they name, and an unknown tab leaves Working hours', () => {
    const page = read('src/app/calendar/page.js');
    assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
    assert.match(page, /TABS\.some\(\(t\) => t\.id === wanted\)\) setTab\(wanted\)/);
    for (const id of ['hours', 'holidays', 'terms']) assert.ok(page.includes(`id: '${id}'`), id);
  });
});

describe('the hub holds no setting of its own (AC2)', () => {
  const hub = read('src/app/settings/page.js') + read('src/lib/ui/settings-hub.js');

  it('has no field, switch or save, and makes no request', () => {
    assert.doesNotMatch(hub, /<input|<select|<textarea|<Switch|type="submit"|onSubmit|apiFetch|fetch\(|method: '(PUT|POST|PATCH|DELETE)'/);
  });

  it('the Transaction settings form still saves through Operations, from its own screen, through the same helper', () => {
    const form = read('src/app/settings/transactions/page.js');
    assert.match(form, /import \{ getSettings \} from '..\/..\/..\/lib\/api\/operations\.js'/);
    assert.match(form, /saveSettings\(\{ form, version: settings\.version \}\)/);
    assert.match(form, /import Counters from '..\/Counters\.js'/);
  });

  it('uses the shared Card, StatusBadge and StatusBanner, and the design tokens, with a visible focus ring', () => {
    const page = read('src/app/settings/page.js');
    for (const name of ['Card', 'StatusBadge', 'StatusBanner']) assert.match(page, new RegExp(`import ${name} from`), name);
    assert.match(page, /focus-visible:ring-2 focus-visible:ring-pup-maroon/);
    assert.doesNotMatch(page, /#[0-9a-fA-F]{6}/, 'no new colour');
  });

  it('the Transactions page header icon goes straight to Transaction settings', () => {
    assert.match(read('src/app/transactions/page.js'), /<Link href="\/settings\/transactions" className="btn-secondary btn-icon"/);
  });

  it('says the settings are view-only to anyone but a Super Admin', () => {
    assert.match(read('src/app/settings/page.js'), /user\.role !== ROLES\.SUPER_ADMIN \? <StatusBanner variant="info" message="You can view these settings\. Only a Super Admin can change them\."/);
  });
});
