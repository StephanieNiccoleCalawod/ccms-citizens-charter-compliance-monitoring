// CC027 change (K14): the Executive gets a read-only Transactions list and detail. Navigation, page roles and action visibility,
// as pure functions and source checks. The Operations service stays authoritative (apps/operations-service/test/cc027-*.test.js).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { TRANSACTION_OPERATOR_ROLES, TRANSACTION_PAGE_ROLES, appNavForRole, isTransactionReadOnly, transactionsNav } from '../../src/lib/auth/permissions.js';
import { EMPTY_TX_FILTERS, readOnlyFilters } from '../../src/lib/ui/transaction-list.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const OPERATORS = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF];

describe('navigation and page roles', () => {
  it('the Executive gets the Transactions menu item, and still no Start Transaction item', () => {
    assert.deepEqual(transactionsNav(ROLES.EXECUTIVE), { section: 'Main', label: 'Transactions', href: '/transactions' });
    const nav = appNavForRole(ROLES.EXECUTIVE);
    assert.ok(nav.some((i) => i.href === '/transactions'));
    assert.ok(!nav.some((i) => i.href === '/transactions/new'));
    assert.ok(nav.some((i) => i.href === '/campus'), 'Campus Home is still there');
    assert.ok(nav.some((i) => i.href === '/settings'), 'Transaction Settings stays a read-only reference item for the Executive');
    assert.equal(new Set(nav.map((i) => i.href)).size, nav.length, 'no duplicated entries');
  });

  it('the other roles keep exactly their menus', () => {
    for (const role of OPERATORS) {
      const nav = appNavForRole(role);
      assert.ok(nav.some((i) => i.href === '/transactions'), role);
      assert.ok(!nav.some((i) => i.href === '/settings'), `${role}: settings stays the header icon`);
      assert.equal(isTransactionReadOnly(role), false, role);
    }
    assert.equal(isTransactionReadOnly(ROLES.EXECUTIVE), true);
    assert.equal(transactionsNav('admin'), null);
  });

  it('list and detail admit the Executive; Add Transaction and the acknowledgement slip stay operator-only', () => {
    assert.deepEqual([...TRANSACTION_PAGE_ROLES].sort(), [...OPERATORS, ROLES.EXECUTIVE].sort());
    assert.deepEqual([...TRANSACTION_OPERATOR_ROLES].sort(), [...OPERATORS].sort());
    assert.match(read('src/app/transactions/page.js'), /allowedRoles=\{TRANSACTION_PAGE_ROLES\}/);
    assert.match(read('src/app/transactions/[id]/page.js'), /allowedRoles=\{TRANSACTION_PAGE_ROLES\}/);
    assert.match(read('src/app/transactions/[id]/acknowledgement/page.js'), /allowedRoles=\{TRANSACTION_OPERATOR_ROLES\}/);
    assert.match(read('src/app/transactions/new/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN, ROLES\.OFFICE_HEAD, ROLES\.OFFICE_STAFF\]\}/);
  });
});

describe('the list, read-only', () => {
  const list = strip(read('src/app/transactions/page.js'));

  it('hides Add Transaction and never mounts the start form for the Executive', () => {
    assert.ok(list.includes('{readOnly ? null : <AddTransactionButton'));
    assert.ok(list.includes('{addOpen && !readOnly ? <StartTransactionForm'));
  });

  it('hides the counter column and filter and never asks for counters; offers the office filter across offices', () => {
    assert.ok(list.includes('{readOnly ? null : <Th className="whitespace-nowrap">Counter</Th>}'));
    assert.ok(list.includes("{readOnly ? null : <td className=\"td\">{t.counter_label || '-'}</td>}"));
    assert.ok(list.includes('const showCounter = !readOnly && options.counters.length > 0;'));
    assert.ok(list.includes('readOnly ? Promise.resolve(null) : listCounters(undefined)'));
    assert.ok(list.includes('const campusWide = isSuperAdmin || readOnly;'));
    assert.ok(list.includes('{campusWide ? ('));
    assert.ok(list.includes('const columns = readOnly ? READ_ONLY_COLUMNS : COLUMNS;'));
  });

  it('a counter filter carried in an old address is dropped for the Executive (the service would refuse it)', () => {
    const filters = { ...EMPTY_TX_FILTERS, status: 'COMPLETED', office_id: 'o-1', counter_id: 'c-1', q: 'PUP' };
    assert.deepEqual(readOnlyFilters(filters), { ...filters, counter_id: '' });
    assert.ok(list.includes('readOnlyFilters(parsed.filters)'));
  });

  it('shows no staff, client or registry column, and no staff-name search', () => {
    assert.doesNotMatch(list, /started_by|client_email|client_reference|registry_student_number|registry_miss_note/);
  });

  it('the details modal is keyed by role and transaction, and a refused list closes any open detail', () => {
    assert.ok(list.includes('key={`${user.role}:${selectedId}`}'));
    assert.ok(list.includes('if (err?.status === 401 || err?.status === 403) setSelectedId(null);'));
  });
});

describe('the detail, read-only', () => {
  const detail = strip(read('src/components/transactions/TransactionDetail.js'));

  it('uses the shared read-only rule', () => {
    assert.ok(detail.includes('export const isReadOnlyRole = isTransactionReadOnly;'));
    assert.ok(detail.includes('const readOnly = isReadOnlyRole(role);'));
  });

  it('shows no Start, Hold, Resume, Complete, Cancel, Check status or Print acknowledgement control to the Executive', () => {
    assert.ok(detail.includes('{!readOnly && !outcomeUnknown && (canHold(tx, holdEnabled) || onHold || canComplete(tx) || canCancel(tx, role)) ? ('));
    assert.match(detail, /\{readOnly \? null : \(\s*<p className="mt-2">\s*<Link href=\{`\/transactions\/\$\{tx\.transaction_id\}\/acknowledgement`\}/);
    assert.ok(detail.includes('{embedded || readOnly ? null : <Link href="/transactions/new"'));
    assert.ok(detail.includes('{!readOnly && outcomeUnknown ? ('));
    assert.ok(detail.includes('{!readOnly && mustResumeFirst(tx) ?'));
    assert.ok(detail.includes('if (busyRef.current || !canComplete(tx) || readOnly) return;'));
    assert.ok(detail.includes('if (!readOnly) loadSettings();'));
  });

  it('hides the sections that depend on restricted data (Started by, registry, counter) and keeps client type (spec 6.5)', () => {
    assert.match(detail, /\{readOnly \? null : \(\s*<Item label="Started by" testId="started-by">/);
    assert.ok(detail.includes('<Item label="Client type">{clientTypeLabel(tx.client_type)}</Item>'));
    assert.ok(detail.includes("{!readOnly && tx.registry_status && tx.registry_status !== 'NONE' ? ("));
    assert.ok(detail.includes('{!readOnly && tx.counter_label ? <Item label="Counter">'));
  });

  it('the detail page is keyed by role and address, so a change of either never shows the previous record', () => {
    assert.ok(read('src/app/transactions/[id]/page.js').includes('key={`${user.role}:${id}`}'));
  });
});
