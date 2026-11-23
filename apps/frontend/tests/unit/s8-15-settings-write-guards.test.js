// S8-15 (FE side of a regression check): after the Settings move, a settings change is still checked on the server and audited, and the
// screens never offer a change the server would refuse. The server's guards are READ from the backend source (nothing is changed or run
// there); each is compared with what the frontend offers to each role.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { MESSAGES as SAVE, saveFailureMessage } from '../../src/lib/ui/save-feedback.js';
import { canEditOfficeSchedule, saveFailure } from '../../src/lib/ui/office-schedule.js';
import { canChangeTransactionSettings, saveSettings } from '../../src/lib/ui/transaction-settings.js';
import { settingsHubForRole } from '../../src/lib/ui/settings-hub.js';

const FE = fileURLToPath(new URL('../../', import.meta.url));
const APPS = join(FE, '..');
const read = (path) => readFileSync(path, 'utf8');
const fe = (path) => read(join(FE, path));
const be = (path) => read(join(APPS, path));
const apiError = (status, code = 'X', message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const roleName = (token) => ROLES[token.replace('ROLES.', '')];

/** The roles a route lets through to a write: `const canWrite = requirePermission([ROLES.A, ROLES.B], ...)` or `guard([...])`. */
function writersIn(source, name) {
  const match = new RegExp(`const ${name} = (?:requirePermission|guard)\\(\\[([^\\]]*)\\]`).exec(source);
  assert.ok(match, `no ${name} in the route`);
  return match[1].split(',').map((t) => t.trim()).filter(Boolean).map(roleName);
}

// The settings writes (BE route, guard name) and what the frontend offers for each.
const SETTINGS_WRITES = [
  { what: 'transaction settings (PUT /settings)', route: 'operations-service/src/app/api/settings/route.js', guard: 'canWrite', offered: (role) => canChangeTransactionSettings(role) },
  { what: 'counters, create (POST /counters)', route: 'operations-service/src/app/api/counters/route.js', guard: 'canWrite', offered: (role) => canChangeTransactionSettings(role) },
  { what: 'counters, edit (PUT /counters/:id)', route: 'operations-service/src/app/api/counters/[id]/route.js', guard: 'canWrite', offered: (role) => canChangeTransactionSettings(role) },
  { what: 'permission switches (PUT /permission-switches)', route: 'identity-service/src/app/api/permission-switches/route.js', guard: 'superAdminOnly', offered: (role) => role === ROLES.SUPER_ADMIN && /const canManageSwitches = user\?\.role === ROLES\.SUPER_ADMIN/.test(fe('src/app/settings/roles/page.js')) },
  { what: 'campus working hours (PUT /schedule)', route: 'core-service/src/app/api/schedule/route.js', guard: 'canWrite', offered: (role) => canEditOfficeSchedule(role) },
  { what: 'office working hours (PUT and DELETE /offices/:id/schedule)', route: 'core-service/src/app/api/offices/[id]/schedule/route.js', guard: 'canWrite', offered: (role) => canEditOfficeSchedule(role) },
  { what: 'holidays and suspensions (POST /exceptions)', route: 'core-service/src/app/api/exceptions/route.js', guard: 'canWrite', offered: (role) => role === ROLES.SUPER_ADMIN && /const canWrite = user\.role === ROLES\.SUPER_ADMIN/.test(fe('src/app/calendar/page.js')) },
  { what: 'holidays and suspensions (PUT and DELETE /exceptions/:id)', route: 'core-service/src/app/api/exceptions/[id]/route.js', guard: 'canWrite', offered: (role) => role === ROLES.SUPER_ADMIN && /const canWrite = user\.role === ROLES\.SUPER_ADMIN/.test(fe('src/app/calendar/page.js')) },
  { what: 'offices (POST /offices)', route: 'core-service/src/app/api/offices/route.js', guard: 'canWrite', offered: (role) => role === ROLES.SUPER_ADMIN && /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/.test(fe('src/app/offices/page.js')) },
  { what: 'offices (PUT /offices/:id)', route: 'core-service/src/app/api/offices/[id]/route.js', guard: 'canWrite', offered: (role) => role === ROLES.SUPER_ADMIN && /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/.test(fe('src/app/offices/page.js')) },
];

describe('the server refuses what the screen does not offer (AC1)', () => {
  for (const write of SETTINGS_WRITES) {
    it(`${write.what}: the server lets in ${'Super Admin only'}, and the frontend offers the change to exactly those roles`, () => {
      const allowed = writersIn(be(write.route), write.guard);
      assert.deepEqual(allowed, [ROLES.SUPER_ADMIN], `server guard of ${write.route}`);
      for (const role of ROLE_LIST) assert.equal(write.offered(role), allowed.includes(role), `${role}: frontend offers it only if the server allows it`);
    });
  }

  it('institution code and the calendar "applies to" setting: the server checks the role inside the change and answers 403 (and audits the refusal)', () => {
    const source = be('core-service/src/lib/catalogue/settings.js');
    assert.match(source, /const denied = actor\.role !== ROLES\.SUPER_ADMIN;/);
    assert.match(source, /action: 'CATALOGUE_SETTINGS_CHANGE_REJECTED'/);
    assert.match(source, /error: denied \? Errors\.forbidden\(\)/);
  });

  it('the Settings hub offers "Can change" only to the Super Admin, and never for a read-only item', () => {
    for (const role of ROLE_LIST) {
      const edits = settingsHubForRole(role, { clerk: true }).flatMap((g) => g.items).filter((i) => i.access === 'edit');
      assert.equal(edits.length > 0, role === ROLES.SUPER_ADMIN, role);
    }
  });
});

describe('a refusal (403) from the server is said plainly and never shown as a success (AC1)', () => {
  it('transaction settings: 403 is "forbidden", nothing is reported as saved', async () => {
    const result = await saveSettings({ form: { hold_enabled: true, counters_enabled: false, auto_close_simple: '', auto_close_complex: '', auto_close_highly_technical: '' }, version: 1, put: async () => { throw apiError(403, 'FORBIDDEN'); } });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'forbidden');
    assert.match(result.message, /Super Admin|permission|not allowed|only/i);
  });

  it('working hours: 403 says only a Super Admin can change a schedule', () => {
    assert.deepEqual(saveFailure(apiError(403, 'FORBIDDEN')), { kind: 'error', message: 'Only a Super Admin can change an office schedule.' });
  });

  it('every other settings save: 401 / 403 is "You are not authorized to perform this action."', () => {
    for (const status of [401, 403]) assert.equal(saveFailureMessage(apiError(status)), SAVE.unauthorized);
    assert.equal(SAVE.unauthorized, 'You are not authorized to perform this action.');
  });

  it('a success is only reported after the server answered ok (the catch path never says "saved")', () => {
    const transactions = fe('src/app/settings/transactions/page.js');
    const confirmSave = transactions.slice(transactions.indexOf('async function confirmSave'), transactions.indexOf('// Loads again'));
    assert.ok(confirmSave.indexOf("'Settings saved.'") > confirmSave.indexOf('if (result.ok)'), 'the success sentence is inside the ok branch');
  });
});

describe('each authorised change is audited with who and when (AC2)', () => {
  const audited = [
    ['transaction settings', 'operations-service/src/modules/transaction/settings.js', /TRANSACTION_SETTINGS_UPDATED/],
    ['counters', 'operations-service/src/modules/transaction/counters.js', /recordAudit/],
    ['permission switches', 'identity-service/src/lib/permission-switches.js', /recordAudit/],
    ['campus working hours', 'core-service/src/lib/calendar/schedule.js', /recordAudit/],
    ['office working hours', 'core-service/src/lib/calendar/office-schedule.js', /OFFICE_SCHEDULE_UPDATED/],
    ['holidays and suspensions', 'core-service/src/lib/calendar/exceptions.js', /recordAudit/],
    ['offices', 'core-service/src/lib/catalogue/offices.js', /recordAudit/],
    ['institution code and "applies to"', 'core-service/src/lib/catalogue/settings.js', /CATALOGUE_SETTINGS_UPDATED/],
  ];
  for (const [what, file, pattern] of audited) {
    it(`${what}: the backend records an audit event for the change (${file.split('/').pop()})`, () => {
      assert.match(be(file), pattern);
      assert.match(be(file), /recordAudit\(/);
    });
  }

  it('the audit log screen shows who (actor) and when (date and time) for each entry, and lets a Super Admin filter by action', () => {
    const lib = fe('src/lib/ui/audit-log.js');
    assert.match(lib, /export function actorOf\(event\)/);
    assert.match(lib, /export function splitDateTime/);
    assert.match(lib, /EMPTY_AUDIT_FILTERS = Object\.freeze\(\{ actor: '', action: ''/);
    assert.match(fe('src/app/logs/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
  });
});

describe('no secret reaches a settings screen (AC3)', () => {
  it('the screens that show settings never print or store a key, token or password from a settings response', () => {
    const screens = ['src/app/settings/page.js', 'src/app/settings/transactions/page.js', 'src/app/settings/roles/page.js', 'src/components/account/PermissionSwitches.js', 'src/components/offices/InstitutionCodePanel.js', 'src/components/calendar/AppliesToSetting.js'];
    for (const file of screens) assert.doesNotMatch(fe(file).replace(/switch_key|switchKey|SWITCH_KEYS|\bkey=\{/g, ''), /secret|api[_-]?key|private[_-]?key|\bpassword\b.*\.(value|text)|localStorage\.setItem\([^)]*token/i, file);
  });

  it('the backend lists machine keys as metadata only: the key and its hash are never returned (read from the route)', () => {
    assert.match(be('core-service/src/app/api/machine-keys/route.js'), /Metadata only: the key and its hash are never returned/);
  });
});
