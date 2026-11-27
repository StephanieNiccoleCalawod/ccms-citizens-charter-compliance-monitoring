// The Account Settings sidebar: item order, the Transaction settings / Roles and permissions / Access requests
// visual grouping, and that each item still routes directly to its own separate page.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { SUBGROUP_LABELS, accountNavGroups, defaultSettingsHref, navSegments } from '../../src/lib/ui/account-nav.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

const settingsIds = (role) => accountNavGroups(role).find((g) => g.id === 'settings')?.items.map((i) => i.id) ?? [];

describe('Settings sidebar order and per-page routes', () => {
  it('Super Admin sees Institution code, Transaction settings, Roles and permissions, Access requests, Notification Center, Connected systems, Security and sessions, in that order (no General item)', () => {
    assert.deepEqual(
      settingsIds(ROLES.SUPER_ADMIN),
      ['institution-code', 'transactions', 'roles', 'access', 'notifications', 'connected-systems', 'security'],
    );
    for (const role of Object.values(ROLES)) {
      const items = accountNavGroups(role).find((g) => g.id === 'settings')?.items ?? [];
      assert.ok(!items.some((i) => i.id === 'general'), `${role} has no unified General item`);
      assert.ok(items.every((i) => i.scrollId === undefined), `${role} uses direct per-page navigation`);
    }
  });

  it('every item keeps its own standalone route', () => {
    const items = accountNavGroups(ROLES.SUPER_ADMIN).find((g) => g.id === 'settings').items;
    const hrefOf = (id) => items.find((i) => i.id === id)?.href;
    assert.equal(hrefOf('institution-code'), '/settings/institution-code');
    assert.equal(hrefOf('transactions'), '/settings/transactions');
    assert.equal(hrefOf('roles'), '/settings/roles');
    assert.equal(hrefOf('access'), '/access');
    assert.equal(hrefOf('notifications'), '/settings/notifications');
    assert.equal(hrefOf('connected-systems'), '/settings/connected-systems');
    assert.equal(hrefOf('security'), '/settings/security');
  });

  it('defaultSettingsHref points to each role’s first visible Settings page', () => {
    assert.equal(defaultSettingsHref(ROLES.SUPER_ADMIN), '/settings/institution-code');
    assert.equal(defaultSettingsHref(ROLES.OFFICE_HEAD), '/settings/transactions');
    assert.equal(defaultSettingsHref(ROLES.OFFICE_STAFF), '/settings/transactions');
    assert.equal(defaultSettingsHref(ROLES.EXECUTIVE), '/settings/transactions');
  });

  it('a role without Roles and permissions (Office Head) still gets Transaction settings and Access requests next to each other', () => {
    const ids = settingsIds(ROLES.OFFICE_HEAD);
    assert.ok(!ids.includes('roles'), 'Office Head has no Roles and permissions item');
    const txIndex = ids.indexOf('transactions');
    const accessIndex = ids.indexOf('access');
    assert.ok(txIndex >= 0 && accessIndex === txIndex + 1, 'transactions and access are still consecutive');
  });
});

describe('navSegments: the shared visual connector is a rendering hint only', () => {
  it('groups a consecutive run sharing the same `group` tag into one segment, and leaves the rest single', () => {
    const items = accountNavGroups(ROLES.SUPER_ADMIN).find((g) => g.id === 'settings').items;
    const segments = navSegments(items);
    assert.deepEqual(segments.map((s) => s.kind), ['single', 'group', 'single', 'single', 'single']);
    const group = segments.find((s) => s.kind === 'group');
    assert.deepEqual(group.items.map((i) => i.id), ['transactions', 'roles', 'access']);
  });

  it('with only two of the three visible, they still form one group (never left ungrouped or merged with an unrelated item)', () => {
    const items = accountNavGroups(ROLES.OFFICE_HEAD).find((g) => g.id === 'settings').items;
    const segments = navSegments(items);
    const group = segments.find((s) => s.kind === 'group');
    assert.deepEqual(group.items.map((i) => i.id), ['transactions', 'access']);
  });

  it('every item is still its own page: grouping never merges hrefs, forms or content', () => {
    const items = accountNavGroups(ROLES.SUPER_ADMIN).find((g) => g.id === 'settings').items;
    const group = navSegments(items).find((s) => s.kind === 'group');
    const hrefs = group.items.map((i) => i.href);
    assert.equal(new Set(hrefs).size, hrefs.length, 'three distinct routes, not merged');
  });
});

describe('AccountShell renders per-page links and the connector for the grouped run, reusing navSegments', () => {
  const shell = read('src/components/layout/AccountShell.js');
  it('imports and calls navSegments instead of a second grouping implementation', () => {
    assert.match(shell, /import \{[^}]*navSegments[^}]*\} from '\.\.\/\.\.\/lib\/ui\/account-nav\.js'/);
    assert.match(shell, /navSegments\(group\.items\)/);
  });
  it('draws one subtle connector (a left border, no extra card or heavy border) beside the grouped items', () => {
    assert.match(shell, /border-l-2 border-white\/20/);
  });
  it('the three pages sit under a non-clickable, collapsible "Office & Access Management" heading that Institution code does not control', () => {
    assert.equal(SUBGROUP_LABELS.workflow, 'Office & Access Management');
    const group = navSegments(accountNavGroups(ROLES.SUPER_ADMIN).find((g) => g.id === 'settings').items).find((s) => s.kind === 'group');
    assert.equal(group.label, 'Office & Access Management');
    assert.ok(!group.items.some((i) => i.id === 'institution-code'));
    assert.match(shell, /<button[\s\S]*aria-expanded=\{subOpen\}[\s\S]*\{segment\.label\}/);
    assert.match(shell, /aria-controls=\{panelId\}/);
    assert.match(shell, /grid-rows-\[0fr\]/);
    // opening a child route expands its tree
    assert.match(shell, /activeItem\?\.group && !openSubgroups\[activeItem\.group\]/);
  });
  it('uses the same maroon sidebar palette as the main AppShell', () => {
    const app = read('src/components/layout/AppShell.js');
    for (const token of ['bg-[#3D0606]', 'bg-[#783535]', 'text-[#E5B53A]', 'border-white/10']) {
      assert.ok(shell.includes(token) && app.includes(token), token);
    }
  });
  it('removes scrollSpy/useScrollSpy and renders navigation items as Links', () => {
    assert.doesNotMatch(shell, /scrollSpy|useScrollSpy|scrollId/);
    assert.match(shell, /<Link href=\{item\.href\}/);
  });
});

describe('Settings root redirect and standalone Institution code page', () => {
  it('/settings redirects to defaultSettingsHref without rendering unified sections', () => {
    const settingsPage = read('src/app/settings/page.js');
    assert.match(settingsPage, /defaultSettingsHref/);
    assert.match(settingsPage, /router\.replace/);
    assert.doesNotMatch(settingsPage, /TransactionSettingsManager|NotificationCenter|GeneralSettings|scrollSpy/);
  });

  it('/settings/institution-code is Super Admin only and reads CATALOGUE_SETTINGS_API', () => {
    const page = read('src/app/settings/institution-code/page.js');
    assert.match(page, /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
    assert.match(page, /CATALOGUE_SETTINGS_API/);
    assert.match(page, /InstitutionCodePanel/);
  });
});
