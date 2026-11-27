// CC039 (Take a ticket, queue panel), CC040 (ticket picker, queue wait figures) and CC045 (receipts): the browser-side rules.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PUBLIC_TICKET_API, takeTicket } from '../../src/lib/api/queue.js';
import {
  PRIORITY_OPTIONS,
  buildSampleQueueBoard,
  deriveOfficeCounterMeta,
  describeTakeFailure,
  queueNav,
  queueWaitFigure,
  queueWaitText,
  shortOfficeCode,
  shortOfficeName,
  skipCountdown,
  ticketPickerOptions,
} from '../../src/lib/ui/queue.js';
import { buildStartBody, EMPTY_START_FORM, startErrorResult } from '../../src/lib/ui/start-transaction.js';
import { figureRows } from '../../src/lib/ui/reports.js';
import { tilesFor } from '../../src/lib/ui/kpi-home.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { canSeeReceipts, formatAmount, receiptFailure, receiptFormErrors } from '../../src/lib/ui/receipts.js';
import { fetchReceiptImage } from '../../src/lib/api/receipts.js';

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, blob: async () => body });

describe('CC039 Take a ticket', () => {
  it('sends only the office and the optional priority group, to the public route', async () => {
    const sent = [];
    const fetchImpl = async (url, init) => { sent.push([url, JSON.parse(init.body)]); return reply(201, { ticket_no: 'REG-001' }); };
    assert.equal((await takeTicket({ office_id: 'o1', priority_group: '' }, fetchImpl)).ticket_no, 'REG-001');
    await takeTicket({ office_id: 'o1', priority_group: 'PWD' }, fetchImpl);
    assert.deepEqual(sent, [[PUBLIC_TICKET_API, { office_id: 'o1' }], [PUBLIC_TICKET_API, { office_id: 'o1', priority_group: 'PWD' }]]);
    assert.equal(PUBLIC_TICKET_API, '/api/operations/queue/public/tickets');
  });

  it('handles 429 with the wait, field errors, 503 and the network', async () => {
    const limited = await takeTicket({ office_id: 'o1' }, async () => reply(429, { error: { code: 'RATE_LIMITED', message: 'Too many' } }, { 'retry-after': '120' })).catch((e) => e);
    assert.equal(limited.status, 429);
    assert.equal(limited.retryAfterSeconds, 120);
    assert.match(describeTakeFailure(limited).message, /about 2 minutes/);
    const invalid = await takeTicket({ office_id: 'x' }, async () => reply(400, { error: { message: 'fix', details: { office_id: 'Choose an office from the list.' } } })).catch((e) => e);
    assert.deepEqual(describeTakeFailure(invalid).fields, { office_id: 'Choose an office from the list.' });
    const down = await takeTicket({ office_id: 'o1' }, async () => reply(503, { error: { message: 'down' } })).catch((e) => e);
    assert.match(describeTakeFailure(down).message, /cannot be issued right now/);
    const offline = await takeTicket({ office_id: 'o1' }, async () => { throw new Error('offline'); }).catch((e) => e);
    assert.match(offline.message, /Cannot reach/);
  });

  it('offers the three priority groups, asks for nothing personal, and has a Back link to the landing page', () => {
    assert.deepEqual(PRIORITY_OPTIONS.map((o) => o.value), ['', 'SENIOR_CITIZEN', 'PWD', 'PREGNANT']);
    const page = read('components/queue/TakeTicketForm.js');
    assert.ok(!/name="(name|email|phone)"|type="email"|autoComplete="name"/.test(page));
    assert.match(page, /href="\/"[\s\S]*?&larr;<\/span>\s*Back/);
    assert.match(read('components/public/LandingHero.js'), /href="\/queue\/take"/);
    assert.doesNotMatch(read('components/layout/PublicHeader.js'), /href="\/queue\/take"/);
  });
});

describe('CC039 staff panel', () => {
  it('the Skip countdown follows the server time and enables at 3:00', () => {
    const ticket = { skippable_at: '2026-11-13T01:03:00.000Z' };
    assert.deepEqual(skipCountdown(ticket, Date.parse('2026-11-13T01:00:01.000Z')), { ready: false, text: 'Skip available in 2:59' });
    assert.deepEqual(skipCountdown(ticket, Date.parse('2026-11-13T01:03:00.000Z')), { ready: true, text: 'Skip is available now' });
    assert.equal(skipCountdown({ skippable_at: null }, 0), null);
  });

  it('the Queue menu item is for operators only', () => {
    assert.ok(queueNav('office_staff') && queueNav('office_head') && queueNav('super_admin'));
    assert.equal(queueNav('executive'), null);
    assert.ok(appNavForRole('office_staff').some((i) => i.href === '/queue'));
    assert.ok(!appNavForRole('executive').some((i) => i.href === '/queue'));
  });

  it('derives office short codes, quick jump names, counter windows, and isolated sample queue boards per office', () => {
    assert.equal(shortOfficeCode('PUP-ACAD', 'Campus Academic Office'), 'ACAD');
    assert.equal(shortOfficeCode('PUP-ADMREG', 'Campus Admission and Registration Section'), 'ADM');
    assert.equal(shortOfficeName('Campus Academic Office', 'PUP-ACAD'), 'Academic Office');
    assert.equal(shortOfficeName('Campus Student Affairs and Services Office', 'PUP-OSAS'), 'Student Affairs (OSAS)');

    const meta = deriveOfficeCounterMeta(
      { office_id: 'o-acad', office_code: 'PUP-ACAD', office_name: 'Campus Academic Office', is_active: true },
      0,
      [],
    );
    assert.equal(meta.shortCode, 'ACAD');
    assert.equal(meta.ticketPrefix, 'ACAD-000');
    assert.equal(meta.counterWindow, 'Window 1 · Academic');
    assert.equal(meta.routingPolicy, 'Priority First');
    assert.equal(meta.ready, true);

    const customMeta = deriveOfficeCounterMeta(
      { office_id: 'o-reg', office_code: 'PUP-REG', office_name: "Campus Registrar's Office", is_active: true },
      1,
      [{ counter_id: 'c1', office_id: 'o-reg', label: 'Window A · Credentials', is_active: true }],
    );
    assert.equal(customMeta.counterWindow, 'Window A · Credentials');

    const sample = buildSampleQueueBoard({ office_id: 'o-acad', office_code: 'PUP-ACAD', office_name: 'Campus Academic Office' });
    assert.equal(sample.board.office_id, 'o-acad');
    assert.equal(sample.board.called[0].ticket_no, 'ACAD-002');
    assert.equal(sample.board.waiting[0].lane, 'PRIORITY', 'priority ticket routes to the top of waiting queue');
    assert.equal(sample.board.counts.waiting, 3);
    assert.equal(sample.board.counts.waiting_priority, 1);
    assert.equal(sample.history.length, 2);
  });

  it('renders State A (Landing Page office selector, quick jump, and 4-column counter grid) and State B (Active Queue Console)', () => {
    const page = read('app/queue/page.js');
    assert.match(page, /title="Queue Management"/);
    const panel = read('components/queue/QueuePanel.js');
    assert.doesNotMatch(panel, /RA 11032 &amp; Priority Lane Enabled/);
    assert.match(panel, /Active Service Counter Office/);
    assert.match(panel, /Counter Console Ready/);
    assert.match(panel, /Choose an office to open its live counter queue/);
    assert.match(panel, /Open counter console/);
    assert.match(panel, /Call Next Ticket/);
    assert.match(panel, /Regular Line/);
    assert.match(panel, /Priority \(SC\/PWD\)/);
    assert.match(panel, /Service \/ Visitor Note \(Optional\)/);
    assert.match(panel, /Called \/ Now Serving/);
    assert.match(panel, /Waiting, in call order/);
    assert.match(panel, /Recently Served &amp; Skipped No-Show Log/);
  });
});

describe('CC040 ticket at Start', () => {
  const board = {
    called: [{ ticket_id: 'c1', ticket_no: 'REG-004', lane: 'REGULAR' }],
    waiting: [{ ticket_id: 'w1', ticket_no: 'REG-006', lane: 'PRIORITY' }, { ticket_id: 'w2', ticket_no: 'REG-005', lane: 'REGULAR' }],
  };
  it('lists the called ticket first, then the waiting line, by display number', () => {
    assert.deepEqual(ticketPickerOptions(board).map((o) => [o.value, o.label]), [
      ['c1', 'REG-004 (called now)'], ['w1', 'REG-006 (waiting, priority)'], ['w2', 'REG-005 (waiting)'],
    ]);
    assert.deepEqual(ticketPickerOptions(null), []);
  });

  it('sends the ticket id only when chosen; an older body is unchanged', () => {
    const form = { ...EMPTY_START_FORM, service_id: 's', client_type: 'EMPLOYEE' };
    assert.deepEqual(buildStartBody({ form, countersEnabled: false }), { service_id: 's', client_type: 'EMPLOYEE', requirements_confirmed: true });
    assert.equal(buildStartBody({ form: { ...form, queue_ticket_id: 'c1' }, countersEnabled: false }).queue_ticket_id, 'c1');
  });

  it('a stale, used or cross-office ticket is shown at the picker', () => {
    for (const [status, code] of [[409, 'QUEUE_TICKET_USED'], [409, 'QUEUE_TICKET_EXPIRED'], [400, 'QUEUE_TICKET_INVALID'], [400, 'QUEUE_TICKET_AFTER_START']]) {
      const r = startErrorResult({ status, code, message: 'm', details: { queue_ticket_id: 'Pick another' } });
      assert.deepEqual([r.kind, r.fieldErrors], ['queue_ticket', { queue_ticket: 'Pick another' }]);
    }
  });

  it('the picker is cleared when the office changes and the wait is never shown as 0 for "no ticket"', () => {
    const source = read('components/transactions/StartTransactionForm.js');
    assert.match(source, /if \(!sameOffice\) setForm\(\(f\) => \(\{ \.\.\.f, queue_ticket_id: '' \}\)\);/);
    assert.equal(queueWaitText(null), null);
    assert.equal(queueWaitText(0), '0 min');
  });

  it('KPI tiles and report rows show the queue wait as its own figure; an older report shows "-"', () => {
    const tile = tilesFor({ queue_wait: { measured: 4, average_minutes: 7.5 } }).find((t) => t.key === 'queue_wait');
    assert.deepEqual([tile.value, tile.note], ['7.5 min', '4 measured']);
    assert.equal(tilesFor({ queue_wait: { measured: 0, average_minutes: null } }).find((t) => t.key === 'queue_wait').value, '-');
    assert.equal(queueWaitFigure({ queue_wait: { measured: 2, average_minutes: 5 } }), '5 min average (2 measured)');
    assert.equal(queueWaitFigure({ queue_wait: { measured: 0, average_minutes: null } }), 'Not measured');
    const rows = figureRows({ figures: { services: [], total: { received: 3, results: {} } } });
    assert.equal(rows.at(-1).queueWait, '-');
  });
});

describe('CC045 receipts', () => {
  const file = (name, size) => ({ name, size });
  const ok = { file: file('r.jpg', 1000), or_number: '0001234', amount: '150.00', receipt_date: '2026-11-12' };
  it('checks the photo and the details like the server', () => {
    assert.deepEqual(receiptFormErrors(ok, '2026-11-13'), {});
    assert.deepEqual(receiptFormErrors({ ...ok, file: file('r.PNG', 2 * 1024 * 1024) }, '2026-11-13'), {}, '2 MB inclusive');
    assert.ok(receiptFormErrors({ ...ok, file: file('r.jpg', 2 * 1024 * 1024 + 1) }, '2026-11-13').file);
    assert.ok(receiptFormErrors({ ...ok, file: file('r.gif', 10) }, '2026-11-13').file);
    assert.ok(receiptFormErrors({ ...ok, file: null }, '2026-11-13').file);
    for (const amount of ['0', '0.00', '1.234', '-1', 'abc', '']) assert.ok(receiptFormErrors({ ...ok, amount }, '2026-11-13').amount, amount);
    assert.ok(receiptFormErrors({ ...ok, or_number: 'a b' }, '2026-11-13').or_number);
    assert.ok(receiptFormErrors({ ...ok, receipt_date: '2026-11-14' }, '2026-11-13').receipt_date);
  });

  it('formats the fixed-precision amount without floats and maps server failures to fields', () => {
    assert.equal(formatAmount('1234567.50'), '₱1,234,567.50');
    assert.equal(formatAmount(null), '-');
    assert.deepEqual(receiptFailure({ status: 400, details: { file: 'Use a JPG or PNG photo.' } }).fields, { file: 'Use a JPG or PNG photo.' });
    assert.match(receiptFailure({ status: 403 }).message, /permission/);
  });

  it('Executive never gets the receipt section; the photo is fetched with the session, not linked', async () => {
    assert.equal(canSeeReceipts('executive'), false);
    assert.ok(['office_staff', 'office_head', 'super_admin'].every(canSeeReceipts));
    const detail = read('components/transactions/TransactionDetail.js');
    assert.match(detail, /!readOnly && canSeeReceipts\(role\) \? <ReceiptPanel/);
    const seen = [];
    const blob = await fetchReceiptImage('t1', { token: async () => 'tok', fetchImpl: async (url, init) => { seen.push([url, init.headers.authorization, init.cache]); return reply(200, 'BYTES'); } });
    assert.equal(blob, 'BYTES');
    assert.deepEqual(seen, [['/api/operations/transactions/t1/receipt/image', 'Bearer tok', 'no-store']]);
    const panel = read('components/transactions/ReceiptPanel.js');
    assert.match(panel, /URL\.revokeObjectURL/);
    assert.ok(!/src=\{`\/api|src="\/api/.test(panel), 'no direct image URL');
  });
});
