// S8-14 (FE): daily work stays on its own pages, lasting configuration is reached from Settings, and after the move
//   AC1  no setting can be changed from two different forms
//   AC2  no orphan link remains: every internal address the frontend links, redirects or navigates to opens a page that exists.
// Static checks over the source (no browser); the real-system walk-through is a separate script.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { SETTINGS_GROUPS } from '../../src/lib/ui/settings-hub.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const sources = walk(SRC).filter((f) => f.endsWith('.js'));
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const read = (f) => readFileSync(f, 'utf8');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---- the pages on disk, as patterns ('/services/[id]' matches '/services/abc'; '[[...rest]]' matches any tail)
const APP = join(SRC, 'app');
const pages = walk(APP).filter((f) => /[\\/]page\.js$/.test(f)).map((f) => `/${relative(APP, f).split(sep).join('/').replace(/\/?page\.js$/, '')}`);
const patterns = pages.map((p) => new RegExp(`^${p.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, '(?:/.*)?').replace(/\[[^\]]+\]/g, '[^/]+')}$`));
const normalise = (target) => target.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, 'X').replace(/\/+$/, '') || '/';
const isAsset = (target) => /\.[a-z0-9]{2,5}$/i.test(target);
const opens = (target) => {
  const clean = normalise(target);
  return isAsset(clean) ? existsSync(join(ROOT, 'public', clean)) : patterns.some((re) => re.test(clean));
};

// ---- every internal address the code links, redirects or navigates to (reliable forms only: never an API path)
const RULES = [
  /href=\{?\s*["'`](\/[^"'`]*)["'`]/g, // <Link href="/x"> and href={'/x'}
  /href:\s*["'`](\/[^"'`]*)["'`]/g, // menu and hub data
  /(?:router\.(?:push|replace)|window\.location\.(?:assign|replace)|redirect)\(\s*["'`](\/[^"'`]*)["'`]/g, // navigation
  /_PATH\s*=\s*["'`](\/[^"'`]*)["'`]/g, // CLERK_SIGN_IN_PATH, ACCESS_PENDING_PATH, DIRECTORY_PATH ...
];
function internalLinks() {
  const found = [];
  for (const file of sources) {
    const text = stripComments(read(file));
    for (const rule of RULES) for (const m of text.matchAll(rule)) found.push({ file: rel(file), target: m[1] });
  }
  // The shared menu (read only): every menu item and every landing page.
  const nav = stripComments(read(join(ROOT, '../../packages/ccms-shared/src/nav.js')));
  for (const m of nav.matchAll(/href:\s*'(\/[^']*)'/g)) found.push({ file: 'packages/ccms-shared/src/nav.js', target: m[1] });
  for (const m of nav.matchAll(/\[ROLES\.[A-Z_]+\]:\s*'(\/[^']*)'/g)) found.push({ file: 'packages/ccms-shared/src/nav.js', target: m[1] });
  return found.filter(({ target }) => !/^\/(api|_next)(\/|$)/.test(target));
}

describe('no orphan links (AC2)', () => {
  const links = internalLinks();

  it('finds the links it is meant to check (so a green result means something)', () => {
    assert.ok(pages.length >= 30, `${pages.length} pages on disk`);
    assert.ok(links.length >= 60, `${links.length} internal links found`);
    const targets = new Set(links.map((l) => normalise(l.target)));
    for (const expected of ['/settings', '/settings/transactions', '/settings/roles', '/calendar', '/accounts', '/offices', '/transactions', '/login']) assert.ok(targets.has(expected), `the scan sees ${expected}`);
  });

  it('every internal address the frontend links, redirects or navigates to opens a page (or a file in /public) that exists', () => {
    const orphans = links.filter((l) => !opens(l.target)).map((l) => `${l.target}  (in ${l.file})`);
    assert.deepEqual(orphans, [], `orphan links:\n  ${orphans.join('\n  ')}`);
  });

  it('every item in the Settings hub, and every item of every role\'s menu, opens a page', () => {
    for (const group of SETTINGS_GROUPS) for (const item of group.items) assert.ok(opens(item.href), `${item.id}: ${item.href}`);
    for (const role of ROLE_LIST) for (const item of appNavForRole(role)) assert.ok(opens(item.href), `${role}: ${item.label} -> ${item.href}`);
  });

  it('the addresses that moved or were redirected earlier still open something useful', () => {
    for (const old of ['/settings', '/settings/transactions', '/settings/roles', '/settings/clerk-access', '/calendar', '/accounts', '/offices', '/services']) assert.ok(opens(old), old);
    assert.match(read(join(APP, 'settings/clerk-access/page.js')), /router\.replace\('\/accounts\?tab=clerk'\)/);
  });

  it('nothing still links the Transaction Settings form at its old address by mistake', () => {
    const stale = links.filter((l) => normalise(l.target) === '/settings' && !['src/lib/auth/permissions.js', 'src/lib/ui/settings-hub.js', 'packages/ccms-shared/src/nav.js', 'src/app/settings/transactions/page.js'].includes(l.file));
    assert.deepEqual(stale.map((l) => l.file), [], '/settings is the hub; only the menu, the hub and the "Settings" crumb of the form it leads to point at it');
    assert.match(read(join(APP, 'settings/transactions/page.js')), /breadcrumb=\{\[\{ label: 'Settings', href: '\/settings' \}/);
  });
});

describe('daily work stays on its own pages', () => {
  it('holidays and suspensions live on the Calendar page, and account provisioning on the Accounts page, each with its own menu item', () => {
    for (const [role, hrefs] of [[ROLES.SUPER_ADMIN, ['/calendar', '/accounts']], [ROLES.OFFICE_HEAD, ['/calendar']], [ROLES.OFFICE_STAFF, ['/calendar']], [ROLES.EXECUTIVE, ['/calendar']]]) {
      for (const href of hrefs) assert.ok(appNavForRole(role).some((i) => i.href === href), `${role}: ${href}`);
    }
    assert.match(read(join(APP, 'calendar/page.js')), /<Holidays canWrite=\{canWrite\}/);
    assert.match(read(join(APP, 'accounts/page.js')), /Create CCCMS accounts and control who can sign in\./);
  });

  it('the hub only links to them; it creates, edits and deletes nothing', () => {
    const hub = read(join(APP, 'settings/page.js')) + read(join(SRC, 'lib/ui/settings-hub.js'));
    assert.doesNotMatch(hub, /apiFetch|fetch\(|method: '(PUT|POST|PATCH|DELETE)'|<form|<input/);
  });
});

describe('each setting is changed from one form only (AC1)', () => {
  const screens = sources.filter((f) => /[\\/](app|components)[\\/]/.test(f));
  const usedBy = (pattern) => screens.filter((f) => pattern.test(stripComments(read(f)))).map(rel).sort();

  it('permission switches: only the Roles and permissions page saves them', () => {
    assert.deepEqual(usedBy(/\bsavePermissionSwitches\b/), ['src/app/settings/roles/page.js']);
  });

  it('transaction settings (hold, counters, auto-close): only the Transaction settings page saves them; counters are managed in one component', () => {
    assert.deepEqual(usedBy(/\bsaveSettings\b/), ['src/app/settings/transactions/page.js']);
    assert.deepEqual(usedBy(/\bputSettings\b/), [], 'no screen calls the raw PUT: it goes through saveSettings');
    assert.deepEqual(usedBy(/\b(createCounter|updateCounter|deactivateCounter|reactivateCounter)\b/), ['src/app/settings/Counters.js'], 'counters are managed in one component');
    assert.deepEqual(usedBy(/from '\.\.\/Counters\.js'|from '\.\/Counters\.js'/), ['src/app/settings/transactions/page.js'], 'and shown on the Transaction settings page only');
  });

  it('working hours: one editor saves a schedule; the "use the campus schedule again" action is on the same screen', () => {
    assert.deepEqual(usedBy(/\bsaveOfficeSchedule\b|\bsaveCampusSchedule\b/), ['src/app/calendar/WorkingHoursModal.js']);
    assert.deepEqual(usedBy(/\bresetOfficeSchedule\b/), ['src/app/calendar/WorkingHoursScope.js']);
  });

  it('institution code: only the Offices panel writes it; the "applies to" calendar setting: only the Holidays screen writes it', () => {
    const writers = (field) => sources.filter((f) => new RegExp(`CATALOGUE_SETTINGS_API,\\s*\\{\\s*method: 'PUT',\\s*body: \\{ ${field}`).test(read(f))).map(rel);
    assert.deepEqual(writers('institution_code'), ['src/components/offices/InstitutionCodePanel.js']);
    assert.deepEqual(writers('applies_to_enabled'), ['src/components/calendar/AppliesToSetting.js']);
    assert.deepEqual(usedBy(/\bInstitutionCodePanel\b/).filter((f) => f !== 'src/components/offices/InstitutionCodePanel.js'), ['src/app/offices/page.js']);
    assert.deepEqual(usedBy(/\bAppliesToSetting\b/).filter((f) => f !== 'src/components/calendar/AppliesToSetting.js'), ['src/app/calendar/Holidays.js']);
  });

  it('Clerk sign-in access: one form (the Accounts tab); the old address only redirects to it', () => {
    assert.doesNotMatch(read(join(APP, 'settings/clerk-access/page.js')), /apiFetch|<form|<input/);
    assert.deepEqual(usedBy(/lib\/api\/clerk-access\.js/), ['src/components/account/ClerkAccessPanel.js'], 'the Clerk access API is used by one panel');
    assert.deepEqual(usedBy(/\bClerkAccessPanel\b/).filter((f) => !f.endsWith('ClerkAccessPanel.js')), ['src/app/accounts/page.js'], 'and that panel is only on the Accounts page');
  });

  it('the Settings hub holds none of them', () => {
    const hub = read(join(APP, 'settings/page.js'));
    for (const name of ['saveSettings', 'savePermissionSwitches', 'saveOfficeSchedule', 'saveCampusSchedule', 'InstitutionCodePanel', 'AppliesToSetting']) assert.ok(!hub.includes(name), name);
  });
});
