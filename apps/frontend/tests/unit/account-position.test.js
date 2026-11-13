// CC046: staff position or designation (label only), frontend side: the account form, the accounts table and filter, and
// "Started by" on a transaction. Logic is tested directly; the screens are checked from source (there is no browser here).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import {
  NAME_NOT_RECORDED,
  NO_POSITION,
  POSITION_MAX,
  POSITION_TOO_LONG,
  accountBody,
  accountToForm,
  accountsParams,
  normalizePosition,
  positionCounter,
  positionError,
  positionLabel,
  starterLabels,
} from '../../src/lib/ui/account-position.js';
import { hasChanges } from '../../src/lib/ui/dirty-registry.js';
import { ACCOUNTS_API } from '../../src/lib/api/identity.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const accounts = read('src/app/accounts/page.js');
const detail = read('src/components/transactions/TransactionDetail.js');

const ACCOUNT = { account_id: 'a-1', employee_no: 'E-1', full_name: 'Juan Dela Cruz', email: 'juan@pup.edu.ph', role: ROLES.OFFICE_STAFF, office_id: 'o-1', position: 'Administrative Aide III', is_active: true };

describe('the position text', () => {
  it('is trimmed, optional and limited to 100 characters, with a counter', () => {
    assert.equal(POSITION_MAX, 100);
    assert.equal(normalizePosition('  Clerk II  '), 'Clerk II');
    assert.equal(normalizePosition(null), '');
    assert.equal(normalizePosition(undefined), '');
    assert.equal(normalizePosition(5), '');
    assert.equal(positionError(''), null);
    assert.equal(positionError('   '), null);
    assert.equal(positionError('x'.repeat(100)), null);
    assert.equal(positionError('x'.repeat(101)), POSITION_TOO_LONG);
    assert.equal(positionError(`  ${'x'.repeat(100)}  `), null, 'outer spaces do not count');
    assert.equal(positionCounter('  Clerk  '), '5/100');
    assert.equal(positionCounter(''), '0/100');
    assert.equal(positionCounter('x'.repeat(101)), '101/100');
  });

  it('shows a neutral dash when there is none', () => {
    for (const value of [null, undefined, '', '   ']) assert.equal(positionLabel(value), NO_POSITION);
    assert.equal(NO_POSITION, '—');
    assert.equal(positionLabel(' Registrar II '), 'Registrar II');
  });
});

describe('Add Account and Edit Account', () => {
  it('Add Account shows an empty, optional Position / Designation field with a counter and a hint', () => {
    assert.match(accounts, /const EMPTY_FORM = \{[^}]*position: ''/);
    assert.match(accounts, /htmlFor="position">Position \/ Designation</);
    assert.doesNotMatch(accounts, /htmlFor="position">Position \/ Designation<RequiredMark/, 'it is optional');
    assert.match(accounts, /data-testid="position-counter"/);
    assert.match(accounts, /Optional\./);
    assert.match(accounts, /It does not change what the person can do/);
  });

  it('Edit Account starts from the saved position, and an account without one starts with an empty field (never "null")', () => {
    assert.equal(accountToForm(ACCOUNT).position, 'Administrative Aide III');
    assert.equal(accountToForm({ ...ACCOUNT, position: null }).position, '');
    assert.equal(accountToForm({ ...ACCOUNT, position: undefined }).position, '');
    assert.match(accounts, /account \? accountToForm\(account\) : \{ \.\.\.EMPTY_FORM \}/);
  });

  it('sends the position through the existing account API: trimmed text, or null to clear', () => {
    const form = { ...accountToForm(ACCOUNT), position: '  Registrar II  ' };
    assert.equal(accountBody(form, { officeBound: true }).position, 'Registrar II');
    assert.equal(accountBody({ ...form, position: '' }, { officeBound: true }).position, null, 'emptying the field clears it');
    assert.equal(accountBody({ ...form, position: '   ' }, { officeBound: true }).position, null);
    assert.match(accounts, /accountBody\(form, \{ officeBound: isOfficeBound\(form\.role\) \}\)/);
    assert.match(accounts, /method: 'PUT', body/);
    assert.match(accounts, /method: 'POST', body: \{ \.\.\.body, password: form\.password \}/);
  });

  it('role and office handling are untouched, and the password is still asked only when adding', () => {
    const body = accountBody({ ...accountToForm(ACCOUNT), role: ROLES.EXECUTIVE, office_id: 'o-1' }, { officeBound: false });
    assert.equal(body.office_id, null, 'a role without an office never sends one');
    assert.equal(body.role, ROLES.EXECUTIVE);
    assert.deepEqual(Object.keys(accountBody(accountToForm(ACCOUNT), { officeBound: true })).sort(), ['email', 'employee_no', 'full_name', 'office_id', 'position', 'role']);
    assert.match(accounts, /function changeRole\(role\)/);
    assert.match(accounts, /\{!form\.id \? \(\s*<PasswordField/);
  });

  it('a position over the limit is refused before sending, and the service\'s own message is shown under the field', () => {
    assert.match(accounts, /const tooLong = positionError\(form\.position\);/);
    assert.match(accounts, /setFieldErrors\(\{ position: tooLong \}\)/);
    assert.match(accounts, /<FieldError id="position-error">\{fieldErrors\.position\}<\/FieldError>/);
    assert.match(accounts, /aria-invalid=\{fieldErrors\.position/);
    assert.match(accounts, /setFieldErrors\(err\.details && typeof err\.details === 'object' \? err\.details : \{\}\)/, 'Identity\'s field problems still map to their fields');
    assert.match(accounts, /positionError\(form\.position\) \? 'font-semibold text-red-700'/, 'the counter turns red over the limit');
  });

  it('keeps the form dirty-state behaviour: a changed position counts as an unsaved change, an unchanged one does not', () => {
    const opened = accountToForm(ACCOUNT);
    assert.equal(hasChanges(opened, { ...opened }), false);
    assert.equal(hasChanges(opened, { ...opened, position: 'Registrar II' }), true);
    const noPosition = accountToForm({ ...ACCOUNT, position: null });
    assert.equal(hasChanges(noPosition, { ...noPosition }), false, 'an account without a position opens clean');
    assert.equal(hasChanges(noPosition, { ...noPosition, position: 'Clerk' }), true);
    assert.equal(hasChanges(opened, { ...opened, position: '' }), true, 'clearing a saved position is a change');
    assert.match(accounts, /const formDirty = useFormDirty\(form\)/);
    assert.match(accounts, /dirty=\{formDirty\}/);
  });

  it('trims the typed text when the field is left', () => {
    assert.match(accounts, /onBlur=\{\(e\) => setForm\(\(current\) => \(current \? \{ \.\.\.current, position: e\.target\.value\.trim\(\) \} : current\)\)\}/);
  });
});

describe('the accounts table', () => {
  it('has a Position column between the name (with its employee number) and the rest, and a dash for none', () => {
    const head = accounts.slice(accounts.indexOf('<Th>Name</Th>'), accounts.indexOf('<Th align="right">Actions</Th>'));
    assert.deepEqual([...head.matchAll(/<Th>([^<]+)<\/Th>/g)].map((m) => m[1]), ['Name', 'Position', 'Email', 'Role', 'Office', 'Status']);
    assert.match(accounts, /<p className="text-xs text-slate-500">\{account\.employee_no\}<\/p>/);
    assert.match(accounts, /<td className="td" data-testid="account-position">\{positionLabel\(account\.position\)\}<\/td>/);
    assert.match(accounts, /colSpan=\{7\}/);
    assert.doesNotMatch(accounts, /colSpan=\{6\}/);
  });

  it('still uses the shared table and its existing paging and sorting', () => {
    assert.match(accounts, /<TableShell footer=\{<Pager/);
    assert.match(accounts, /sortNewestFirst\(all\)/);
    assert.match(accounts, /pageSlice\(list\.items, page, pageSize\)/);
    assert.match(accounts, /fetchEveryPage\(apiFetch/);
  });
});

// The Position filter used to be a second search box. The accounts service already matches `q` against the name, email,
// employee number AND position in one search (any letter case, any part), so the screen now has only the one Search box.
describe('the one Search box covers position too', () => {
  const base = { page: 1, pageSize: 100, q: '', role: '', office_id: '', status: 'active' };

  it('accountsParams has no separate position parameter; q alone is sent to the service', () => {
    const query = (over) => accountsParams({ ...base, ...over });
    assert.equal(query({ q: 'aide' }).get('q'), 'aide');
    assert.equal(query({ q: 'AIDE' }).get('q'), 'AIDE', 'the same search either way: the service ignores case');
    assert.equal(query({ q: '  aide ' }).get('q'), 'aide');
    assert.equal(query({ q: '' }).has('q'), false);
    assert.equal(query({ q: '   ' }).has('q'), false);
    assert.doesNotMatch(accountsParams.toString(), /position/, 'accountsParams takes no position argument');
    const all = query({ q: 'aide', role: ROLES.OFFICE_STAFF, office_id: 'o-1', status: 'inactive', page: 3, pageSize: 50 });
    assert.deepEqual(Object.fromEntries(all), { page: '3', page_size: '50', q: 'aide', role: ROLES.OFFICE_STAFF, office_id: 'o-1', status: 'inactive' });
    assert.equal(`${ACCOUNTS_API}?${query({ q: 'aide' })}`.startsWith('/api/identity/accounts?'), true);
  });

  it('the page has one Search box (no separate Position field), waits for a pause in typing, and restarts at page 1', () => {
    assert.doesNotMatch(accounts, /filter-position|appliedPosition|filters\.position/, 'the Position filter box is gone');
    assert.match(accounts, /htmlFor="account-search">Search</);
    assert.match(accounts, /setAppliedQuery\(filters\.q\);\s*setPage\(1\);/);
    assert.match(accounts, /\}, \[appliedQuery, role, office_id, status\]\);/);
  });

  it('does not fetch more than the existing flow: one request per page of the search, with the filter applied by the service', () => {
    assert.equal((accounts.match(/accountsParams\(/g) ?? []).length, 1);
    assert.doesNotMatch(accounts, /\.filter\([^)]*position/, 'no filtering of the loaded list in the browser');
  });
});

describe('Started by on the transaction detail', () => {
  it('shows the name with the position underneath', () => {
    assert.deepEqual(starterLabels({ started_by_name: 'Juan Dela Cruz', started_by_position: 'Administrative Aide III' }), { name: 'Juan Dela Cruz', hasName: true, position: 'Administrative Aide III' });
    const at = (needle) => detail.indexOf(needle);
    assert.ok(at('label="Started by"') > 0);
    assert.ok(at('data-testid="started-by-name"') < at('data-testid="started-by-position"'), 'position is below the name');
    assert.match(detail, /const starter = starterLabels\(tx\);/);
  });

  it('old transactions and ones without the labels show a neutral fallback, never a guess', () => {
    assert.deepEqual(starterLabels({ started_by_name: null, started_by_position: null }), { name: NAME_NOT_RECORDED, hasName: false, position: NO_POSITION });
    assert.deepEqual(starterLabels({}), { name: NAME_NOT_RECORDED, hasName: false, position: NO_POSITION });
    assert.deepEqual(starterLabels(null), { name: NAME_NOT_RECORDED, hasName: false, position: NO_POSITION });
    assert.equal(starterLabels({ started_by_name: '  ', started_by_position: '  ' }).hasName, false);
    assert.equal(starterLabels({ started_by_name: 'Ana', started_by_position: null }).position, NO_POSITION);
    assert.equal(starterLabels({ started_by_name: null, started_by_position: 'Clerk' }).position, 'Clerk');
  });

  it('reads the copy stored with the transaction: the page asks Identity for nothing and never uses the account\'s current name', () => {
    assert.doesNotMatch(detail, /ACCOUNTS_API|api\/identity/);
    assert.doesNotMatch(read('src/lib/ui/account-position.js'), /apiFetch|fetch\(/);
    assert.doesNotMatch(detail, /started_by\b(?!_)/, 'the account id is not used to look anyone up');
  });

  it('keeps the existing detail: tracking number, status, the other fields and the actions are still there', () => {
    for (const text of ['data-testid="tracking-no"', 'data-testid="status"', 'label="Service"', 'label="Office"', 'label="Standard saved with it"', 'label="Started"', 'label="Elapsed time"', 'label="Client type"', 'data-testid="compliance"', 'grid gap-4 sm:grid-cols-2']) {
      assert.ok(detail.includes(text), text);
    }
  });
});

describe('a position is a label and nothing more', () => {
  it('no permission, navigation or access code in the frontend looks at it', () => {
    for (const file of ['src/lib/auth/permissions.js', 'src/lib/auth/guards.js', 'src/lib/auth/session.js', 'src/components/layout/AppShell.js']) {
      assert.doesNotMatch(read(file), /\bposition\b/i, file);
    }
  });

  it('the accounts page is still for Super Admin only', () => {
    assert.match(accounts, /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
  });
});
