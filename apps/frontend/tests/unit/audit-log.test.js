import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST, ROLES } from 'ccms-shared/roles';
import { AUDIT_EVENTS_API, AUDIT_PAGE_SIZE, auditEventsUrl, auditQuery, listAuditEvents } from '../../src/lib/api/logs.js';
import { appNavForRole, logsNav } from '../../src/lib/auth/permissions.js';
import {
  EMPTY_AUDIT_FILTERS,
  FORBIDDEN_MESSAGE,
  HIDDEN,
  RANGE_MESSAGE,
  SERVER_ERROR_MESSAGE,
  actorOf,
  auditErrorResult,
  auditFilterErrors,
  auditPageCount,
  auditValueTree,
  buildNameMap,
  entityName,
  resolveEntityName,
  entityTypeLabel,
  humanizeKey,
  searchProblem,
  searchToFilters,
  shortId,
  showingRange,
  splitDateTime,
} from '../../src/lib/ui/audit-log.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const ACTOR = '3f2b9c1a-0d4e-4b7a-9c21-5e8f6a7b1c2d';

describe('who gets the Logs page', () => {
  it('only Super Admin has the Logs menu item; every other role keeps its menu without it', () => {
    assert.deepEqual(logsNav(ROLES.SUPER_ADMIN), { section: 'Administration', label: 'Logs', href: '/logs' });
    for (const role of ROLE_LIST.filter((r) => r !== ROLES.SUPER_ADMIN)) {
      assert.equal(logsNav(role), null, role);
      assert.ok(!appNavForRole(role).some((item) => item.href === '/logs'), role);
    }
    assert.ok(appNavForRole(ROLES.SUPER_ADMIN).some((item) => item.href === '/logs'));
  });

  it('an unrecognized role gets no menu at all', () => {
    for (const role of ['admin', undefined, null, '']) assert.deepEqual(appNavForRole(role), []);
    assert.equal(logsNav('admin'), null);
  });

  it('existing navigation is unchanged: Home first, the shared pages and Transaction Settings still there', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.equal(nav[0].href, '/', role);
      // Transaction Settings is the icon on the Transactions page for the three roles that have it; only Executive keeps the menu item.
      assert.equal(nav.some((item) => item.href === '/settings'), role === ROLES.EXECUTIVE, role);
      assert.ok(nav.some((item) => item.href === '/services') && nav.some((item) => item.href === '/calendar'), role);
    }
    assert.deepEqual(appNavForRole(ROLES.SUPER_ADMIN).filter((i) => i.section === 'Administration').map((i) => i.label), ['Accounts', 'Offices', 'Logs']);
  });

  it('the page is limited to Super Admin by the app shell, and the menu item is not a plain link in the shared nav', () => {
    assert.match(read('src/app/logs/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
  });
});

describe('the request the page sends (the verified GET /audit-events contract)', () => {
  it('goes through the gateway as /api/logs/audit-events', () => {
    assert.equal(AUDIT_EVENTS_API, '/api/logs/audit-events');
    assert.equal(AUDIT_PAGE_SIZE, 20);
  });

  it('sends only the filters that are filled, with the exact parameter names and YYYY-MM-DD dates', () => {
    const filters = { actor: ACTOR, action: 'OFFICE_CREATED', entity_type: 'office', from: '2026-11-01', to: '2026-11-10' };
    assert.equal(auditQuery(filters, 2), `?actor=${ACTOR}&action=OFFICE_CREATED&entity_type=office&from=2026-11-01&to=2026-11-10&page=2&page_size=20`);
    assert.equal(auditQuery(EMPTY_AUDIT_FILTERS, 1), '?page=1&page_size=20');
    assert.equal(auditQuery({ ...EMPTY_AUDIT_FILTERS, from: '2026-11-01' }, 1), '?from=2026-11-01&page=1&page_size=20');
    assert.equal(auditEventsUrl({ ...EMPTY_AUDIT_FILTERS, action: '  X  ' }, 3), '/api/logs/audit-events?action=X&page=3&page_size=20');
  });

  it('keeps the filters when the page changes', () => {
    const filters = { ...EMPTY_AUDIT_FILTERS, action: 'ACCOUNT_CREATED', from: '2026-11-01' };
    for (const page of [1, 2, 3]) assert.match(auditEventsUrl(filters, page), /action=ACCOUNT_CREATED&from=2026-11-01&page=/);
  });

  it('is a GET with nothing in the body: the client has no write call', async () => {
    const calls = [];
    const result = await listAuditEvents(EMPTY_AUDIT_FILTERS, 1, async (...args) => (calls.push(args), { items: [], total: 0 }));
    assert.deepEqual(calls, [['/api/logs/audit-events?page=1&page_size=20']]);
    assert.deepEqual(result, { items: [], total: 0 });
    const code = read('src/lib/api/logs.js').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /method\s*:|POST|PUT|PATCH|DELETE/);
  });

  it('counts pages from the total the service returns', () => {
    assert.equal(auditPageCount(0, 20), 1);
    assert.equal(auditPageCount(20, 20), 1);
    assert.equal(auditPageCount(21, 20), 2);
    assert.equal(auditPageCount(69, 20), 4);
  });
});

describe('filter validation', () => {
  const ok = { ...EMPTY_AUDIT_FILTERS };

  it('empty filters are fine', () => assert.deepEqual(auditFilterErrors(ok), {}));

  it('an actor must be a user ID', () => {
    assert.deepEqual(auditFilterErrors({ ...ok, actor: ACTOR }), {});
    assert.deepEqual(auditFilterErrors({ ...ok, actor: ` ${ACTOR.toUpperCase()} ` }), {});
    for (const bad of ['admin', '123', 'not-a-uuid', ACTOR.slice(1)]) assert.match(auditFilterErrors({ ...ok, actor: bad }).actor, /user ID/, bad);
  });

  it('action and entity type are at most 80 characters', () => {
    assert.deepEqual(auditFilterErrors({ ...ok, action: 'A'.repeat(80), entity_type: 'e'.repeat(80) }), {});
    assert.match(auditFilterErrors({ ...ok, action: 'A'.repeat(81) }).action, /80 characters/);
    assert.match(auditFilterErrors({ ...ok, entity_type: 'e'.repeat(81) }).entity_type, /80 characters/);
  });

  it('dates must be real days, and the start may not be after the end', () => {
    assert.deepEqual(auditFilterErrors({ ...ok, from: '2026-11-10', to: '2026-11-10' }), {});
    assert.deepEqual(auditFilterErrors({ ...ok, from: '2026-11-10' }), {});
    assert.match(auditFilterErrors({ ...ok, from: '2026-02-30' }).from, /valid date/);
    assert.match(auditFilterErrors({ ...ok, to: '11/10/2026' }).to, /valid date/);
    assert.equal(auditFilterErrors({ ...ok, from: '2026-11-11', to: '2026-11-10' }).from, `${RANGE_MESSAGE}.`);
    assert.equal(RANGE_MESSAGE, 'From date must be on or before To date');
  });
});

describe('what a failed request says', () => {
  it('403 says permission is missing, with no server detail', () => {
    const result = auditErrorResult(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js:1'));
    assert.deepEqual(result, { message: FORBIDDEN_MESSAGE, fieldErrors: {} });
    assert.doesNotMatch(result.message, /srv|x\.js|Insufficient/);
  });

  it('401 asks the person to sign in again (the client also sends them to sign-in)', () => assert.match(auditErrorResult(apiError(401, 'UNAUTHORIZED')).message, /sign in again/));

  it('a network failure keeps the client\'s readable message; server errors get a safe one', () => {
    assert.equal(auditErrorResult(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.')).message, 'Cannot reach the server. Check your connection and try again.');
    for (const status of [500, 502, 503]) {
      const result = auditErrorResult(apiError(status, 'INTERNAL_ERROR', 'pg: relation audit_log does not exist at db.js:9'));
      assert.equal(result.message, SERVER_ERROR_MESSAGE, String(status));
      assert.doesNotMatch(result.message, /pg|relation|db\.js/);
    }
  });

  it('a 400 puts the service\'s message next to the filter it names', () => {
    const result = auditErrorResult(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { from: 'From date must be on or before To date', actor: 'actor must be a valid ID' }));
    assert.equal(result.message, null);
    assert.equal(result.fieldErrors.from, 'From date must be on or before To date');
    assert.equal(result.fieldErrors.actor, 'Actor: actor must be a valid ID');
  });
});

describe('table cells', () => {
  it('shows the user ID, "System" for the system\'s own entries, and nothing else invented', () => {
    assert.equal(actorOf({ actor_user_id: ACTOR, actor_role: 'super_admin' }), ACTOR);
    assert.equal(actorOf({ actor_user_id: null, actor_role: 'system' }), 'System');
    assert.equal(actorOf({ actor_user_id: null, actor_role: 'super_admin' }), '');
    assert.equal(actorOf({}), '');
  });

  it('shortens long IDs for the table only', () => {
    assert.equal(shortId(ACTOR), '3f2b9c1a…');
    assert.equal(shortId('System'), 'System');
    assert.equal(shortId(null), '');
    assert.equal(shortId(undefined), '');
  });
});

describe('before and after values', () => {
  const leaf = (text) => ({ kind: 'leaf', text });

  it('missing, null and empty values are shown as empty, not as the word "null"', () => {
    assert.deepEqual(auditValueTree(null), { kind: 'empty' });
    assert.deepEqual(auditValueTree(undefined), { kind: 'empty' });
    assert.deepEqual(auditValueTree({}), leaf('(none)'));
    assert.deepEqual(auditValueTree([]), leaf('(none)'));
    assert.deepEqual(auditValueTree({ office_id: null }), { kind: 'object', fields: [{ key: 'office_id', label: 'Office id', node: { kind: 'empty' } }] });
  });

  it('non-object values are plain text', () => {
    assert.deepEqual(auditValueTree('hello'), leaf('hello'));
    assert.deepEqual(auditValueTree(42), leaf('42'));
    assert.deepEqual(auditValueTree(true), leaf('Yes'));
    assert.deepEqual(auditValueTree(''), leaf('(empty)'));
  });

  it('keeps nested fields and lists, in order', () => {
    const tree = auditValueTree({ items: [{ day_of_week: 1, is_working: true }, { day_of_week: 2, is_working: false }], note: 'x' });
    assert.deepEqual(tree.fields.map((f) => f.key), ['items', 'note']);
    assert.equal(tree.fields[0].node.kind, 'list');
    assert.deepEqual(tree.fields[0].node.items[1].fields.map((f) => [f.label, f.node.text]), [['Day of week', '2'], ['Is working', 'No']]);
  });

  it('dates and times inside the values use the shared CCMS formats, never the raw ISO text', () => {
    const tree = auditValueTree({ created_at: '2026-11-10T06:05:00Z', exception_date: '2026-11-10', suspended_from: '13:00', opening_time: '08:00' });
    const text = Object.fromEntries(tree.fields.map((f) => [f.key, f.node.text]));
    assert.deepEqual(text, { created_at: '11/10/2026 2:05 PM', exception_date: '11/10/2026', suspended_from: '1:00 PM', opening_time: '8:00 AM' });
  });

  it('secret-looking fields are hidden', () => {
    const tree = auditValueTree({ email: 'a@b.c', password_hash: '$2b$10$abc', token: 'xyz', nested: { service_key: 'k', refresh_token: 'r', ok: 1 } });
    const text = (fields, key) => fields.find((f) => f.key === key).node;
    assert.equal(text(tree.fields, 'email').text, 'a@b.c');
    assert.equal(text(tree.fields, 'password_hash').text, HIDDEN);
    assert.equal(text(tree.fields, 'token').text, HIDDEN);
    assert.equal(text(text(tree.fields, 'nested').fields, 'service_key').text, HIDDEN);
    assert.equal(text(text(tree.fields, 'nested').fields, 'refresh_token').text, HIDDEN);
    assert.equal(text(text(tree.fields, 'nested').fields, 'ok').text, '1');
  });

  it('hostile text stays text (the page renders it as escaped text; nothing here builds HTML)', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    assert.deepEqual(auditValueTree({ description: hostile }).fields[0].node, leaf(hostile));
    assert.doesNotMatch(read('src/components/ui/AuditValue.js') + read('src/app/logs/page.js'), /dangerouslySetInnerHTML|innerHTML/);
  });

  it('very deep data is cut off instead of drawn forever', () => {
    let deep = 'bottom';
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    let node = auditValueTree(deep);
    let depth = 0;
    while (node.kind === 'object') {
      node = node.fields[0].node;
      depth += 1;
    }
    assert.ok(depth <= 7);
    assert.equal(node.text, '(more data not shown)');
  });

  it('keys read as words', () => {
    assert.equal(humanizeKey('suspended_from'), 'Suspended from');
    assert.equal(humanizeKey('office-id'), 'Office id');
    assert.equal(humanizeKey('x'), 'X');
  });
});

describe('the Logs page is read only and keeps its filters honest (source checks, not a browser)', () => {
  const page = read('src/app/logs/page.js');

  it('has no create, edit or delete control and sends no write request', () => {
    assert.doesNotMatch(page, /method\s*:|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b|apiFetch\([^)]*,\s*\{/);
    assert.doesNotMatch(page, />\s*(Add|Edit|Delete|Remove|Save)\b/);
    assert.equal([...page.matchAll(/apiFetch\(/g)].length, 1, 'only the office-name lookup calls apiFetch directly, a plain GET');
    assert.match(page, /apiFetch\(OFFICES_API\)/);
    // accounts and services are read with the paged GET helper (every page), for names only
    assert.match(page, /fetchAllPages\(ACCOUNTS_API, apiFetch\)/);
    assert.match(page, /fetchAllPages\(`\$\{CATALOGUE_API\}\/services`, apiFetch/);
  });

  it('a new search or date range, and Clear, start again at page 1; paging keeps the applied filters', () => {
    assert.match(page, /run\(filters, 1, match\.field/);
    assert.match(page, /run\(\{ \.\.\.EMPTY_AUDIT_FILTERS \}, 1, null\)/);
    assert.match(page, /onPage=\{\(nextPage\) => run\(applied, nextPage\)\}/);
    assert.match(page, /function changePageSize\(value\)[\s\S]*?run\(applied, 1, appliedSearch, nextPageSize\)/);
  });

  it('has the reference layout: one search box, two native dates, no Apply button, and the five columns plus the details control', () => {
    assert.match(page, /<SearchInput\s+id="audit-search"/);
    assert.doesNotMatch(page, /Apply filters/);
    assert.match(page, /<ClearFiltersButton/);
    for (const heading of ['Date &amp; time', 'Done by', 'Action', 'Affected entity', 'Office']) assert.ok(page.includes(heading), heading);
    assert.match(page, /<Pager[\s\S]*?pageSize=\{pageSize\}[\s\S]*?onPageSizeChange=\{changePageSize\}/);
    assert.match(page, /A read-only record of changes made in CCCMS, newest first\. Dates are Manila calendar days \(Asia\/Manila\)\./);
    assert.match(read('src/components/navigation/Pager.js'), /disabled=\{page <= 1 \|\| loading\}/);
    assert.match(read('src/components/navigation/Pager.js'), /disabled=\{page >= pages \|\| loading\}/);
  });

  it('keeps the order the service returns (newest first) and an older answer cannot replace a newer one', () => {
    assert.doesNotMatch(page, /\.sort\(\s*\(a, b\)|items\.sort|\.reverse\(\)/);
    assert.match(page, /id === latest\.current/);
    assert.match(page, /id !== latest\.current/);
  });

  it('uses the shared date helpers and native date inputs without a duplicate date hint', () => {
    assert.match(page, /formatDateTime\(event\.occurred_at\)/);
    assert.equal([...page.matchAll(/type="date"/g)].length, 2);
    assert.equal([...page.matchAll(/<DateHint /g)].length, 0);
  });
});

describe('the single search box', () => {
  const known = { actions: ['ACCOUNT_CREATED', 'OFFICE_UPDATED'], types: ['account', 'transaction_settings'] };

  it('an empty box filters nothing', () => {
    for (const blank of ['', '   ', null, undefined]) assert.deepEqual(searchToFilters(blank), { filter: {}, field: null, value: '' });
  });

  it('a full user ID is the actor filter', () => {
    assert.deepEqual(searchToFilters(` ${ACTOR} `), { filter: { actor: ACTOR }, field: 'actor', value: ACTOR });
  });

  it('a type or action already seen in the log is matched exactly, in any letter case or with spaces', () => {
    assert.deepEqual(searchToFilters('Account', known).filter, { entity_type: 'account' });
    assert.deepEqual(searchToFilters('transaction settings', known).filter, { entity_type: 'transaction_settings' });
    assert.deepEqual(searchToFilters('account created', known).filter, { action: 'ACCOUNT_CREATED' });
    assert.deepEqual(searchToFilters('office_updated', known).filter, { action: 'OFFICE_UPDATED' });
  });

  it('otherwise a lowercase word is an entity type, and anything else is an action written the way actions are stored', () => {
    assert.deepEqual(searchToFilters('counter'), { filter: { entity_type: 'counter' }, field: 'entity_type', value: 'counter' });
    assert.deepEqual(searchToFilters('COUNTER_CREATED').filter, { action: 'COUNTER_CREATED' });
    assert.deepEqual(searchToFilters('Counter created').filter, { action: 'COUNTER_CREATED' });
    assert.deepEqual(searchToFilters('office-deactivated').filter, { action: 'OFFICE_DEACTIVATED' }); // words joined by a hyphen or a space read as an action
    assert.deepEqual(searchToFilters('Office Deactivated').filter, { action: 'OFFICE_DEACTIVATED' });
  });

  it('only ever sets one of the three supported filters, never a name search', () => {
    for (const text of [ACTOR, 'account', 'ACCOUNT_CREATED', 'Ana Reyes', 'x y z']) assert.equal(Object.keys(searchToFilters(text, known).filter).length, 1, text);
    assert.deepEqual(searchToFilters('Ana Reyes').filter, { action: 'ANA_REYES' }); // not a name search: it simply finds no action
  });

  it('is limited to 80 characters', () => {
    assert.equal(searchProblem('x'.repeat(80)), null);
    assert.match(searchProblem('x'.repeat(81)), /80 characters/);
    assert.equal(searchProblem(''), null);
  });
});

describe('names shown in the table (only from real data)', () => {
  const event = (over) => ({ entity_type: 'account', entity_id: 'a1', before_value: null, after_value: null, ...over });

  it('the name of what an entry is about comes from its own before/after values', () => {
    assert.equal(entityName(event({ after_value: { full_name: 'Liza Ramos' } })), 'Liza Ramos');
    assert.equal(entityName(event({ entity_type: 'office', after_value: { office_name: 'Campus Academic Office' } })), 'Campus Academic Office');
    assert.equal(entityName(event({ entity_type: 'counter', before_value: { label: 'Window 1' }, after_value: null })), 'Window 1');
    assert.equal(entityName(event({ after_value: { full_name: 'New' }, before_value: { full_name: 'Old' } })), 'New');
  });

  it('the entity_name sent by the Logs service wins, and a transaction shows its tracking number', () => {
    assert.equal(entityName(event({ entity_type: 'service', entity_name: ' Transcript of Records ', after_value: { service_name: 'Other' } })), 'Transcript of Records');
    assert.equal(entityName(event({ entity_type: 'transaction', entity_name: 'REG-20261030-0001' })), 'REG-20261030-0001');
    assert.equal(entityName(event({ entity_type: 'transaction', after_value: { tracking_no: 'REG-20261030-0002', client_email: 'a@b.co' } })), 'REG-20261030-0002');
  });

  it('never shows citizen details', () => {
    const tree = auditValueTree({ tracking_no: 'REG-20261030-0001', client_email: 'a@b.co', client_reference: '20-1234', student_number: '20-1234' });
    const text = JSON.stringify(tree);
    assert.ok(!text.includes('a@b.co') && !text.includes('20-1234'));
    assert.ok(text.includes('REG-20261030-0001'));
  });

  it('gives nothing (so the page shows the ID) when the values hold no name', () => {
    assert.equal(entityName(event({})), '');
    assert.equal(entityName(event({ after_value: 'text' })), '');
    assert.equal(entityName(event({ after_value: [{ full_name: 'x' }] })), '');
    assert.equal(entityName(event({ after_value: { full_name: '   ' } })), '');
    assert.equal(entityName({}), '');
  });

  it('does not call every entity an account: the type is shown as its own label', () => {
    assert.equal(entityTypeLabel('account'), 'Account');
    assert.equal(entityTypeLabel('transaction_settings'), 'Transaction settings');
    assert.equal(entityTypeLabel('office'), 'Office');
    assert.equal(entityTypeLabel(''), '');
    assert.equal(entityTypeLabel(null), '');
  });

  it('actor names come from the accounts list and from account entries in the log; nothing is invented', () => {
    const names = buildNameMap(
      [{ account_id: 'u1', full_name: 'Ana Reyes' }, { account_id: 'u2' }, null],
      [event({ entity_id: 'u3', after_value: { full_name: 'Carlo Mendoza' } }), event({ entity_id: 'u1', after_value: { full_name: 'Someone Else' } }), event({ entity_type: 'office', entity_id: 'o9', after_value: { office_name: 'An office' } })],
    );
    assert.equal(names.get('u1'), 'Ana Reyes'); // the accounts list wins
    assert.equal(names.get('u3'), 'Carlo Mendoza');
    assert.equal(names.has('u2'), false);
    assert.equal(names.has('o9'), false); // an office is not a person
    assert.equal(buildNameMap().size, 0);
  });
});

describe('table layout helpers', () => {
  it('splits a formatted date-time into two lines', () => {
    assert.deepEqual(splitDateTime('10/23/2026 6:42 PM'), { date: '10/23/2026', time: '6:42 PM' });
    assert.deepEqual(splitDateTime('-'), { date: '-', time: '' });
    assert.deepEqual(splitDateTime(''), { date: '', time: '' });
  });

  it('the "Showing 1–20 of 45" numbers come from the response, never fixed numbers', () => {
    assert.deepEqual(showingRange(1, 20, 4), { from: 1, to: 4 });
    assert.deepEqual(showingRange(1, 20, 45), { from: 1, to: 20 });
    assert.deepEqual(showingRange(3, 20, 45), { from: 41, to: 45 });
    assert.deepEqual(showingRange(2, 20, 40), { from: 21, to: 40 });
    assert.deepEqual(showingRange(1, 20, 0), { from: 0, to: 0 });
  });
});

describe('the table and filter bar after the clean-up (source checks, not a browser)', () => {
  const page = read('src/app/logs/page.js');
  const code = page.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('{/*')).join('\n');

  it('no longer shows the "Showing entries where ..." line under the search field', () => {
    assert.doesNotMatch(page, /Showing entries where/);
    assert.doesNotMatch(page, /role="status"/);
    assert.doesNotMatch(page, /SEARCH_FIELD_LABELS/);
  });

  it('has the five data columns and an accessible details control column', () => {
    assert.equal([...page.matchAll(/<Th[ >]/g)].length, 6, 'five data columns plus the details column, as shared <Th> header cells');
    assert.match(page, /aria-label=\{`\$\{open \? 'Hide' : 'Show'\} details of \$\{event\.action\}`\}/);
    assert.match(page, /rotate-90/);
    assert.match(page, /sr-only">Details</);
    assert.match(page, /const COLUMNS = 6;/);
  });

  it('still opens the before/after details: a labelled button with aria-expanded, plus a clickable row', () => {
    assert.match(code, /aria-expanded=\{open\}/);
    assert.match(code, /aria-controls=\{open \? detailId : undefined\}/);
    assert.match(code, /aria-label=\{`\$\{open \? 'Hide' : 'Show'\} details of \$\{event\.action\}`\}/);
    assert.match(code, /onClick=\{\(\) => toggle\(event\.audit_id\)\}/);
    assert.match(code, /e\.stopPropagation\(\)/);
    assert.match(code, /<section aria-label="Before"/);
    assert.match(code, /<section aria-label="After"/);
  });

  it('keeps the draft and applied filters apart: typing only edits the draft, Apply copies it, Clear resets both', () => {
    assert.match(code, /const \[draft, setDraft\] = useState\(\{ search: '', from: '', to: '' \}\)/);
    assert.match(code, /const \[applied, setApplied\] = useState\(\{ \.\.\.EMPTY_AUDIT_FILTERS \}\)/);
    assert.match(code, /const set = \(name\) => \(e\) => setDraft\(\{ \.\.\.draft, \[name\]: e\.target\.value \}\)/);
    // The only places that fetch are the first load, Apply (the form's submit), Clear and the paging buttons.
    assert.equal([...code.matchAll(/\brun\(/g)].length, 6, 'run( is called by Apply, Clear, Retry and two paging buttons, and defined once');
    assert.equal([...code.matchAll(/listAuditEvents\(/g)].length, 2, 'one for the first load, one inside run');
    assert.match(code, /onSubmit=\{apply\}/);
    assert.match(code, /setDraft\(\{ search: '', from: '', to: '' \}\);\s*setFieldErrors\(\{\}\);\s*run\(\{ \.\.\.EMPTY_AUDIT_FILTERS \}, 1, null\);/);
  });

  it('has no Apply button: dates apply when chosen, the search on Enter or when the field is left, and Clear filters shows only while filters are applied', () => {
    assert.match(code, /\{filtered \? \(/);
    assert.match(code, /onClick=\{clear\}/);
    assert.doesNotMatch(code, /Apply filters/);
    assert.match(code, /function applyNow\(next\)/);
    assert.ok(code.includes('applyNow({ ...draft, from: e.target.value })'));
    assert.ok(code.includes('applyNow({ ...draft, to: e.target.value })'));
  });

  it('stays read only and Super Admin only', () => {
    assert.match(page, /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
    assert.doesNotMatch(code, /method\s*:|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
  });
});

describe('names for older audit entries (FE-04)', () => {
  const lookups = {
    office: new Map([['o1', 'Registrar']]),
    account: new Map([['a1', 'Liza Ramos']]),
    service: new Map([['s1', 'Transcript of Records']]),
  };
  const ev = (over) => ({ entity_type: 'office', entity_id: 'o1', before_value: null, after_value: null, ...over });
  it('uses the entry\'s own name first', () => {
    assert.equal(resolveEntityName(ev({ entity_name: 'Own Name' }), lookups), 'Own Name');
  });
  it('looks an older entry up by type and ID in the lists already loaded', () => {
    assert.equal(resolveEntityName(ev({}), lookups), 'Registrar');
    assert.equal(resolveEntityName(ev({ entity_type: 'account', entity_id: 'a1' }), lookups), 'Liza Ramos');
    assert.equal(resolveEntityName(ev({ entity_type: 'service', entity_id: 's1' }), lookups), 'Transcript of Records');
  });
  it('gives nothing when it cannot be resolved safely, so the page says the name is unavailable', () => {
    assert.equal(resolveEntityName(ev({ entity_id: 'missing' }), lookups), '');
    assert.equal(resolveEntityName(ev({ entity_type: 'service_standard', entity_id: 's1' }), lookups), '');
    assert.equal(resolveEntityName(ev({ entity_type: 'counter', entity_id: 'c1' }), lookups), '');
    assert.equal(resolveEntityName(ev({}), {}), '');
  });
  it('never resolves a transaction by ID', () => {
    assert.equal(resolveEntityName(ev({ entity_type: 'transaction', entity_id: 'o1' }), lookups), '');
  });
});
