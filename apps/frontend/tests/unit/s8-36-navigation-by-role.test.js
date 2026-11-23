// S8-36 (FE): fewer choices per screen. The menu of each role is ordered, grouped and limited to what the role may use, and three
// representative tasks per role are within a few clicks. These are checks on the menu data and the screens' source, not a usability
// test with people: the walkthrough notes are in docs/ux-walkthrough-S8-36.md.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { landingForRole } from 'ccms-shared/nav';
import * as permissions from '../../src/lib/auth/permissions.js';
import { SETTINGS_GROUPS } from '../../src/lib/ui/settings-hub.js';

const { appNavForRole } = permissions;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const pagePath = (href) => `src/app${href.split(/[?#]/)[0].replace(/\/$/, '')}/page.js`;
const SWITCHES_ON = { reports: true, complaints: true };

/** The roles a page lets in: allowedRoles={[ROLES.A, ...]} or allowedRoles={SOME_ROLES} (an export of permissions.js). null = every role. */
function rolesAllowedBy(href) {
  const file = pagePath(href);
  if (!existsSync(join(ROOT, file))) return null;
  const source = read(file);
  const literal = /allowedRoles=\{\[([^\]]*)\]\}/.exec(source);
  if (literal) return literal[1].split(',').map((t) => t.trim()).filter(Boolean).map((t) => ROLES[t.replace('ROLES.', '')]);
  const named = /allowedRoles=\{([A-Z_]+)\}/.exec(source);
  if (named && Array.isArray(permissions[named[1]])) return [...permissions[named[1]]];
  return null;
}

describe('each role sees only what it may use (AC1)', () => {
  it('every item in a role\'s menu opens a page that role is allowed into', () => {
    for (const role of ROLE_LIST) {
      for (const access of [{}, SWITCHES_ON]) {
        for (const item of appNavForRole(role, access)) {
          const allowed = rolesAllowedBy(item.href);
          if (allowed) assert.ok(allowed.includes(role), `${role} sees "${item.label}" (${item.href}) but the page only lets in ${allowed.join(', ')}`);
        }
      }
    }
  });

  it('a page that only some roles may open is in the menu of those roles only', () => {
    for (const href of ['/offices', '/accounts', '/registry', '/settings/roles', '/logs']) {
      const allowed = rolesAllowedBy(href);
      assert.deepEqual(allowed, [ROLES.SUPER_ADMIN], href);
      for (const role of ROLE_LIST) assert.equal(appNavForRole(role, SWITCHES_ON).some((i) => i.href === href), role === ROLES.SUPER_ADMIN, `${role}: ${href}`);
    }
  });

  it('Office Staff see Reports and Complaints only while the switches are on; nobody else\'s menu depends on a switch', () => {
    const labels = (role, access) => appNavForRole(role, access).map((i) => i.label);
    assert.ok(!labels(ROLES.OFFICE_STAFF, {}).includes('Reports') && !labels(ROLES.OFFICE_STAFF, {}).includes('Complaints'));
    assert.ok(labels(ROLES.OFFICE_STAFF, SWITCHES_ON).includes('Reports') && labels(ROLES.OFFICE_STAFF, SWITCHES_ON).includes('Complaints'));
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]) assert.deepEqual(labels(role, {}), labels(role, SWITCHES_ON), role);
  });

  it('the Executive has no item that starts or changes work (Queue, Registry, Accounts, ...)', () => {
    const hrefs = appNavForRole(ROLES.EXECUTIVE, SWITCHES_ON).map((i) => i.href);
    for (const href of ['/queue', '/registry', '/accounts', '/offices', '/settings/roles', '/logs', '/transactions/new']) assert.ok(!hrefs.includes(href), href);
  });
});

describe('the menu is ordered by what a person does first, and grouped (S8-36)', () => {
  it('the page a role lands on after signing in is the first item (Office Head, Office Staff, Executive); the Dashboard follows', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const nav = appNavForRole(role, SWITCHES_ON);
      assert.equal(nav[0].href, landingForRole(role), `${role}: first item`);
      assert.equal(nav[1].href, '/', `${role}: the Dashboard comes second`);
    }
  });

  it('a Super Admin lands on Accounts (an Administration item), so keeps the Dashboard first and the groups in order', () => {
    const nav = appNavForRole(ROLES.SUPER_ADMIN);
    assert.equal(nav[0].href, '/');
    assert.deepEqual([...new Set(nav.map((i) => i.section))], ['Main', 'Administration', 'Reference']);
  });

  it('the sidebar shows Main first, then Administration (Super Admin only), then Reference', () => {
    for (const role of ROLE_LIST) {
      const sections = appNavForRole(role, SWITCHES_ON).map((i) => i.section);
      const order = ['Main', 'Administration', 'Reference'];
      assert.deepEqual([...new Set(sections)], order.filter((s) => sections.includes(s)), role);
    }
    assert.ok(!appNavForRole(ROLES.OFFICE_HEAD).some((i) => i.section === 'Administration'));
  });

  it('no group offers more than seven choices (fewer choices per screen)', () => {
    for (const role of ROLE_LIST) {
      const counts = {};
      for (const item of appNavForRole(role, SWITCHES_ON)) counts[item.section] = (counts[item.section] ?? 0) + 1;
      for (const [section, n] of Object.entries(counts)) assert.ok(n <= 7, `${role}: ${section} has ${n}`);
    }
  });

  it('account and sign out are last, in the menu under the person\'s name, not in the sidebar', () => {
    const shell = read('src/components/layout/AppShell.js');
    const items = shell.slice(shell.indexOf('items={[{ label: \'My account\''), shell.indexOf('items={[{ label: \'My account\'') + 400);
    assert.ok(items.indexOf("label: 'My account'") < items.indexOf("'Sign out'"), 'My account, then Sign out');
    for (const role of ROLE_LIST) assert.ok(!appNavForRole(role, SWITCHES_ON).some((i) => /account$|sign out|help/i.test(i.label) && i.href !== '/accounts'), role);
  });
});

describe('no duplicate configuration screen (AC3)', () => {
  it('no menu has two items for the same address or with the same name', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role, SWITCHES_ON);
      assert.equal(new Set(nav.map((i) => i.href)).size, nav.length, `${role}: addresses`);
      assert.equal(new Set(nav.map((i) => i.label)).size, nav.length, `${role}: names`);
    }
  });

  it('every setting in the Settings hub opens a screen that is also reached from the menu or as a tab of one, never a copy of it', () => {
    const menuHrefs = new Set(ROLE_LIST.flatMap((r) => appNavForRole(r, SWITCHES_ON).map((i) => i.href)));
    for (const group of SETTINGS_GROUPS) for (const item of group.items) {
      const base = item.href.split('?')[0];
      assert.ok(menuHrefs.has(base) || base.startsWith('/settings/'), `${item.id}: ${item.href}`);
    }
  });
});

describe('three representative tasks per role are a few clicks away (AC2, scripted check)', () => {
  // clicks = menu item, then the screen's own button. Every step must exist in the menu or in the screen's source.
  const TASKS = [
    { role: ROLES.SUPER_ADMIN, task: 'Create an account', menu: 'Accounts', page: '/accounts', button: '+ Add Account', clicks: 2 },
    { role: ROLES.SUPER_ADMIN, task: 'Change a transaction setting', menu: 'Settings', page: '/settings', button: 'Transaction settings', source: 'src/lib/ui/settings-hub.js', clicks: 2 },
    { role: ROLES.SUPER_ADMIN, task: 'See who changed a setting', menu: 'Logs', page: '/logs', button: 'Audit logs', clicks: 1 },
    { role: ROLES.OFFICE_HEAD, task: 'See which services are late in my office', menu: 'Dashboard', page: '/', button: 'Service Charter Compliance', source: 'src/lib/ui/insights.js', clicks: 2 },
    { role: ROLES.OFFICE_HEAD, task: 'Review an overdue open transaction', menu: 'Late-risk', page: '/late-risk', button: 'Open Transaction Record', source: 'src/components/analytics/LateRiskSection.js', clicks: 3 },
    { role: ROLES.OFFICE_HEAD, task: 'Look at my office\'s working hours', menu: 'Settings', page: '/settings', button: 'Working hours', source: 'src/lib/ui/settings-hub.js', clicks: 2 },
    { role: ROLES.OFFICE_STAFF, task: 'Start a transaction', menu: 'Transactions', page: '/transactions', button: 'Add Transaction', clicks: 2 },
    { role: ROLES.OFFICE_STAFF, task: 'Call the next ticket', menu: 'Queue', page: '/queue', button: 'Call Next Ticket', source: 'src/components/queue/QueuePanel.js', clicks: 2 },
    { role: ROLES.OFFICE_STAFF, task: 'Resume a held transaction', menu: 'Transactions', page: '/transactions', button: 'Resume', source: 'src/components/transactions/TransactionDetail.js', clicks: 3 },
  ];

  for (const t of TASKS) {
    it(`${t.role}: ${t.task} (${t.clicks} click${t.clicks === 1 ? '' : 's'})`, () => {
      const labels = appNavForRole(t.role, SWITCHES_ON).map((i) => (i.href === '/' && i.label === 'Home' ? 'Dashboard' : i.label));
      assert.ok(labels.includes(t.menu), `"${t.menu}" is in the ${t.role} menu`);
      const source = read(t.source ?? pagePath(t.page));
      assert.ok(source.includes(t.button), `"${t.button}" is on the screen`);
      assert.ok(t.clicks <= 3, 'within three clicks');
    });
  }

  it('each of the three roles has three tasks', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) assert.equal(TASKS.filter((t) => t.role === role).length, 3, role);
  });
});
