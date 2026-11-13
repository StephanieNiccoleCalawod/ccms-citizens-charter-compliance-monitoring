// CC039 browser-side queue rules.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PUBLIC_TICKET_API, takeTicket } from '../../src/lib/api/queue.js';
import { PRIORITY_OPTIONS, describeTakeFailure, queueNav, skipCountdown } from '../../src/lib/ui/queue.js';
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
