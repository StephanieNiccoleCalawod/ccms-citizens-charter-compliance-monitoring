// CC039 queue and CC040 queue wait browser-side rules.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PUBLIC_TICKET_API, takeTicket } from '../../src/lib/api/queue.js';
import { PRIORITY_OPTIONS, describeTakeFailure, queueNav, queueWaitFigure, queueWaitText, skipCountdown, ticketPickerOptions } from '../../src/lib/ui/queue.js';
import { buildStartBody, EMPTY_START_FORM, startErrorResult } from '../../src/lib/ui/start-transaction.js';
import { figureRows } from '../../src/lib/ui/reports.js';
import { tilesFor } from '../../src/lib/ui/kpi-home.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';

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

  it('offers the three priority groups and asks for nothing personal', () => {
    assert.deepEqual(PRIORITY_OPTIONS.map((o) => o.value), ['', 'SENIOR_CITIZEN', 'PWD', 'PREGNANT']);
    const page = read('components/queue/TakeTicketForm.js');
    assert.ok(!/name="(name|email|phone)"|type="email"|autoComplete="name"/.test(page));
    assert.match(read('components/layout/PublicHeader.js'), /href="\/queue\/take"/);
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
