// CC039: queue number without an account. AC1 issuance (public + staff, one sequence, per office, per Manila date, concurrent,
// rate limited), AC2 priority lane and arrival order, AC3 Call next, the 3-minute Skip, competing calls and the access rules.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createMemoryStore, createRateLimiter } from 'ccms-shared';
import { POST as publicIssueRoute } from '../src/app/api/queue/public/tickets/route.js';
import { GET as boardRoute } from '../src/app/api/queue/route.js';
import { POST as staffIssueRoute } from '../src/app/api/queue/tickets/route.js';
import { POST as callNextRoute } from '../src/app/api/queue/call-next/route.js';
import { POST as skipRoute } from '../src/app/api/queue/tickets/[id]/skip/route.js';
import { setQueueLimiter } from '../src/modules/queue/limit.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import {
  PRIORITY_GROUPS, QUEUE_SKIP_GRACE_MS, callNextTicket, issueTicket, parseIssueInput, readNowServing, skipTicket, sortForCalling,
} from '../src/modules/queue/tickets.js';
import { OFFICE_A, OFFICE_B, USERS, admin, call, ctx, head, req, resetData, setupTestEnv, staff, tokens } from './helpers.js';

let env;
let core;
before(async () => {
  env = await setupTestEnv();
  core = createCoreClient();
});
after(async () => {
  setQueueLimiter(null);
  await env?.teardown();
});
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
  // A fresh in-memory limiter per test (the route's default is the database store; see the rate-limit test below).
  setQueueLimiter(createRateLimiter({ store: createMemoryStore() }));
});

const ip = (n = 1) => ({ 'x-forwarded-for': `203.0.113.${n}` });
const takePublic = (body, n = 1) => call(publicIssueRoute, req('POST', '/queue/public/tickets', { body, headers: ip(n) }));
const takeStaff = (body = {}, token = tokens.officeStaffA) => call(staffIssueRoute, req('POST', '/queue/tickets', { token, body }));
const callNext = (body = {}, token = tokens.officeStaffA) => call(callNextRoute, req('POST', '/queue/call-next', { token, body }));
const skip = (id, body = {}, token = tokens.officeStaffA) => call(skipRoute, req('POST', `/queue/tickets/${id}/skip`, { token, body }), ctx(id));
const board = (query = '', token = tokens.officeStaffA) => call(boardRoute, req('GET', `/queue${query}`, { token }));
const ticketCount = async () => (await env.ds.query('SELECT count(*)::int AS n FROM queue_tickets'))[0].n;
const clock = (iso) => { let ms = Date.parse(iso); const now = () => new Date(ms); now.advance = (d) => { ms += d; }; now.set = (v) => { ms = Date.parse(v); }; return now; };
const issueAt = (now, officeId = OFFICE_A, lane = 'REGULAR', actor = null) => issueTicket(env.ds, { core, now }, { officeId, lane, actor });

describe('CC039 AC1: one sequence per office and Manila date', () => {
  it('a signed-out citizen and a staff member draw from the same sequence; another office starts at 001', async () => {
    const first = await takePublic({ office_id: OFFICE_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.ticket_no, 'PUP-OSAS-001');
    assert.equal(first.body.lane, 'REGULAR');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.body.ticket_id, undefined, 'the public answer carries the display number only');

    const second = await takeStaff();
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.ticket_no, 'PUP-OSAS-002');
    assert.equal(second.body.waiting_ahead, 1);

    const otherOffice = await takePublic({ office_id: OFFICE_B }, 2);
    assert.equal(otherOffice.body.ticket_no, 'PUP-ACAD-001');

    const rows = await env.ds.query('SELECT ticket_no, issued_via, issued_by FROM queue_tickets ORDER BY office_code DESC, seq');
    assert.deepEqual(rows.map((r) => [r.ticket_no, r.issued_via, r.issued_by]), [
      ['PUP-OSAS-001', 'PUBLIC', null], ['PUP-OSAS-002', 'STAFF', USERS.staffA], ['PUP-ACAD-001', 'PUBLIC', null],
    ]);
  });

  it('the same office restarts at 001 at Manila midnight (server time, not the browser)', async () => {
    const now = clock('2026-11-13T15:59:59.000Z'); // 23:59:59 in Manila
    const late = await issueAt(now);
    assert.deepEqual([late.ticket_no, late.queue_date], ['PUP-OSAS-001', '2026-11-13']);
    assert.equal((await issueAt(now)).ticket_no, 'PUP-OSAS-002');
    now.set('2026-11-13T16:00:00.000Z'); // 00:00:00 on the 14th in Manila
    const morning = await issueAt(now);
    assert.deepEqual([morning.ticket_no, morning.queue_date], ['PUP-OSAS-001', '2026-11-14']);
  });

  it('concurrent issuance yields distinct numbers 001..N and the database refuses a duplicate', async () => {
    const tickets = await Promise.all(Array.from({ length: 25 }, (_, i) => takePublic({ office_id: OFFICE_A }, 10 + i)));
    assert.ok(tickets.every((t) => t.status === 201), JSON.stringify(tickets.find((t) => t.status !== 201)?.body));
    const numbers = tickets.map((t) => t.body.ticket_no).sort();
    assert.deepEqual(numbers, Array.from({ length: 25 }, (_, i) => `PUP-OSAS-${String(i + 1).padStart(3, '0')}`));
    const [row] = await env.ds.query('SELECT * FROM queue_tickets WHERE seq = 1');
    await assert.rejects(
      env.ds.query(
        `INSERT INTO queue_tickets (ticket_id, office_id, office_code, queue_date, seq, ticket_no, lane, queue_order, issued_at, issued_via)
         VALUES (gen_random_uuid(), $1, 'PUP-OSAS', $2, 1, 'PUP-OSAS-001', 'REGULAR', 999, now(), 'PUBLIC')`,
        [row.office_id, row.queue_date],
      ),
      /queue_tickets_number_uq/,
    );
  });

  it('a rate-limited request creates no ticket and answers 429 with Retry-After', async () => {
    const previous = { limit: process.env.QUEUE_TICKET_RATE_LIMIT, window: process.env.QUEUE_TICKET_RATE_WINDOW_SECONDS };
    process.env.QUEUE_TICKET_RATE_LIMIT = '2';
    process.env.QUEUE_TICKET_RATE_WINDOW_SECONDS = '600';
    try {
      assert.equal((await takePublic({ office_id: OFFICE_A }, 99)).status, 201);
      assert.equal((await takePublic({ office_id: OFFICE_A }, 99)).status, 201);
      const sequenceBefore = (await env.ds.query('SELECT last_seq FROM queue_sequences'))[0].last_seq;
      const limited = await takePublic({ office_id: OFFICE_A }, 99);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error.code, 'RATE_LIMITED');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(await ticketCount(), 2);
      assert.equal((await env.ds.query('SELECT last_seq FROM queue_sequences'))[0].last_seq, sequenceBefore, 'no number was allocated');
      // Even an invalid body is limited first: nothing is read or allocated past the limit.
      assert.equal((await takePublic({ name: 'Juan' }, 99)).status, 429);
      // Another client address is counted separately.
      assert.equal((await takePublic({ office_id: OFFICE_A }, 98)).status, 201);
    } finally {
      process.env.QUEUE_TICKET_RATE_LIMIT = previous.limit ?? '';
      process.env.QUEUE_TICKET_RATE_WINDOW_SECONDS = previous.window ?? '';
      if (previous.limit === undefined) delete process.env.QUEUE_TICKET_RATE_LIMIT;
      if (previous.window === undefined) delete process.env.QUEUE_TICKET_RATE_WINDOW_SECONDS;
    }
  });

  it('the default limiter is the shared database store (rate_limit_hits) keyed per client address', async () => {
    setQueueLimiter(null);
    await env.ds.query('DELETE FROM rate_limit_hits');
    assert.equal((await takePublic({ office_id: OFFICE_A }, 77)).status, 201);
    const [hit] = await env.ds.query("SELECT key, count FROM rate_limit_hits WHERE key LIKE 'queue:issue:%'");
    assert.deepEqual([hit.key, Number(hit.count)], ['queue:issue:203.0.113.77', 1]);
  });

  it('no personal detail is accepted, the office must be an active Core office, and Core down issues nothing', async () => {
    const personal = await takePublic({ office_id: OFFICE_A, name: 'Juan Dela Cruz', email: 'juan@example.com' });
    assert.equal(personal.status, 400);
    assert.deepEqual(Object.keys(personal.body.error.details).sort(), ['email', 'name']);
    assert.equal((await takePublic({})).status, 400);
    assert.equal((await takePublic({ office_id: 'not-a-uuid' })).status, 400);
    assert.equal((await takePublic({ office_id: '00000000-0000-4000-8000-00000000abcd' })).status, 400, 'unknown office');
    env.core.state.offices.get(OFFICE_B).is_active = false;
    try {
      const inactive = await takePublic({ office_id: OFFICE_B });
      assert.equal(inactive.status, 400);
      assert.equal(inactive.body.error.details.office_id, 'Choose an office from the list.');
    } finally {
      env.core.state.offices.get(OFFICE_B).is_active = true;
    }
    env.core.setMode('down');
    const down = await takePublic({ office_id: OFFICE_A });
    assert.equal(down.status, 503);
    assert.equal(down.body.error.code, 'QUEUE_UNAVAILABLE');
    assert.equal(await ticketCount(), 0);
  });
});

describe('CC039 AC2: the priority lane', () => {
  it('every eligible group uses the priority lane and only the lane is stored', async () => {
    for (const group of PRIORITY_GROUPS) {
      const r = await takePublic({ office_id: OFFICE_A, priority_group: group });
      assert.equal(r.status, 201);
      assert.equal(r.body.lane, 'PRIORITY', group);
    }
    assert.equal((await takePublic({ office_id: OFFICE_A, priority_group: 'VIP' })).status, 400);
    const columns = (await env.ds.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'queue_tickets'")).map((c) => c.column_name);
    assert.ok(!columns.some((c) => /group|name|email|phone|reference/.test(c)), columns.join(', '));
    assert.deepEqual(parseIssueInput({ office_id: OFFICE_A, priority_group: '' }), { officeId: OFFICE_A, lane: 'REGULAR' });
  });

  it('priority calls precede regular calls and each lane follows arrival order', async () => {
    const order = [['REGULAR', null], ['PRIORITY', 'SENIOR_CITIZEN'], ['REGULAR', null], ['PRIORITY', 'PWD'], ['PRIORITY', 'PREGNANT'], ['REGULAR', null]];
    const issued = [];
    for (const [, group] of order) issued.push((await takePublic({ office_id: OFFICE_A, priority_group: group })).body.ticket_no);
    const called = [];
    for (let i = 0; i < order.length; i += 1) called.push((await callNext()).body.ticket.ticket_no);
    assert.deepEqual(called, [issued[1], issued[3], issued[4], issued[0], issued[2], issued[5]]);
    assert.deepEqual(sortForCalling([{ lane: 'REGULAR', queue_order: 1 }, { lane: 'PRIORITY', queue_order: 9 }]).map((t) => t.lane), ['PRIORITY', 'REGULAR']);
  });
});

describe('CC039 AC3: Call next and Skip', () => {
  it('an authorised caller calls the next ticket; an empty queue is a clear state', async () => {
    const empty = await callNext();
    assert.equal(empty.status, 200);
    assert.deepEqual([empty.body.queue_empty, empty.body.ticket], [true, null]);
    assert.equal(empty.body.message, 'No one is waiting in the queue.');

    await takePublic({ office_id: OFFICE_A });
    const called = await callNext({}, tokens.officeHeadA);
    assert.equal(called.status, 200);
    assert.equal(called.body.ticket.status, 'CALLED');
    assert.equal(called.body.ticket.ticket_no, 'PUP-OSAS-001');
    assert.equal(called.body.ticket.can_skip, false);
    assert.equal(Date.parse(called.body.ticket.skippable_at) - Date.parse(called.body.ticket.called_at), QUEUE_SKIP_GRACE_MS);

    const panel = await board();
    assert.equal(panel.status, 200);
    assert.equal(panel.body.called[0].ticket_no, 'PUP-OSAS-001');
    assert.equal(panel.body.grace_seconds, 180);
    assert.equal(panel.body.queue_empty, true);
    assert.equal((await callNext()).body.queue_empty, true, 'a called ticket is not called again');
  });

  it('Skip is rejected at 2:59 and moves the ticket to the lane tail at 3:00 with the same number and issue time', async () => {
    const now = clock('2026-11-13T01:00:00.000Z');
    const a = await issueAt(now);
    now.advance(1000);
    await issueAt(now);
    now.advance(1000);
    await issueAt(now);
    now.advance(60_000);
    const { ticket } = await callNextTicket(env.ds, { now }, staff(USERS.staffA), {});
    assert.equal(ticket.ticket_no, a.ticket_no);
    const [before] = await env.ds.query('SELECT issued_at, lane, seq, queue_order FROM queue_tickets WHERE ticket_id = $1', [ticket.ticket_id]);

    now.advance(QUEUE_SKIP_GRACE_MS - 1000); // 2:59
    await assert.rejects(skipTicket(env.ds, { now }, staff(USERS.staffA), ticket.ticket_id, {}), (err) => err.code === 'SKIP_TOO_EARLY' && err.details.skippable_at === ticket.skippable_at);
    now.advance(1000); // 3:00
    const skipped = await skipTicket(env.ds, { now }, staff(USERS.staffA), ticket.ticket_id, { version: ticket.version });
    assert.equal(skipped.ticket.status, 'WAITING');
    assert.equal(skipped.ticket.ticket_no, a.ticket_no);
    assert.equal(skipped.ticket.issued_at, a.issued_at);
    assert.equal(skipped.ticket.called_at, null);
    assert.equal(skipped.ticket.skip_count, 1);
    const [afterRow] = await env.ds.query('SELECT issued_at, lane, seq, queue_order FROM queue_tickets WHERE ticket_id = $1', [ticket.ticket_id]);
    assert.equal(afterRow.issued_at.toISOString(), before.issued_at.toISOString());
    assert.deepEqual([afterRow.lane, afterRow.seq], [before.lane, before.seq]);
    assert.ok(afterRow.queue_order > before.queue_order);

    // Tail of its lane: the two later tickets are called first, then the skipped one with a fresh call time.
    const nextTwo = [(await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket.ticket_no, (await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket.ticket_no];
    assert.deepEqual(nextTwo, ['PUP-OSAS-002', 'PUP-OSAS-003']);
    now.advance(5000);
    const recalled = (await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket;
    assert.equal(recalled.ticket_no, a.ticket_no);
    assert.equal(recalled.called_at, now().toISOString());
    assert.equal(recalled.call_count, 2);
    // A ticket issued after the skip still goes behind it.
    const later = await issueAt(now);
    assert.ok(later.ticket_no > a.ticket_no);
  });

  it('a skipped priority ticket stays in the priority lane, ahead of every regular ticket', async () => {
    const now = clock('2026-11-13T02:00:00.000Z');
    const p = await issueAt(now, OFFICE_A, 'PRIORITY');
    await issueAt(now, OFFICE_A, 'REGULAR');
    const called = (await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket;
    assert.equal(called.ticket_no, p.ticket_no);
    now.advance(QUEUE_SKIP_GRACE_MS);
    await skipTicket(env.ds, { now }, staff(USERS.staffA), called.ticket_id, {});
    assert.equal((await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket.ticket_no, p.ticket_no);
  });

  it('competing calls never claim the same ticket', async () => {
    for (let i = 0; i < 8; i += 1) await takeStaff();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => callNext({}, i % 2 ? tokens.officeStaffA : tokens.officeHeadA)));
    assert.ok(results.every((r) => r.status === 200));
    const numbers = results.filter((r) => r.body.ticket).map((r) => r.body.ticket.ticket_no);
    assert.equal(numbers.length, 8);
    assert.equal(new Set(numbers).size, 8);
    assert.equal(results.filter((r) => r.body.queue_empty).length, 2);
  });

  it('stale, repeated and racing skips are refused', async () => {
    const now = clock('2026-11-13T03:00:00.000Z');
    await issueAt(now);
    const called = (await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket;
    now.advance(QUEUE_SKIP_GRACE_MS);
    await assert.rejects(skipTicket(env.ds, { now }, staff(USERS.staffA), called.ticket_id, { version: called.version + 5 }), { code: 'TICKET_CHANGED' });
    const both = await Promise.allSettled([
      skipTicket(env.ds, { now }, staff(USERS.staffA), called.ticket_id, {}),
      skipTicket(env.ds, { now }, head(USERS.headA), called.ticket_id, {}),
    ]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(both.find((r) => r.status === 'rejected').reason.code, 'TICKET_NOT_CALLED');
    await assert.rejects(skipTicket(env.ds, { now }, staff(USERS.staffA), called.ticket_id, {}), { code: 'TICKET_NOT_CALLED' }, 'a repeated skip');
    // Recalled, then the panel's old version is stale.
    const again = (await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).ticket;
    now.advance(QUEUE_SKIP_GRACE_MS);
    await assert.rejects(skipTicket(env.ds, { now }, staff(USERS.staffA), again.ticket_id, { version: called.version }), { code: 'TICKET_CHANGED' });
    // A ticket of an earlier Manila day is never skipped.
    now.advance(24 * 3600_000);
    await assert.rejects(skipTicket(env.ds, { now }, staff(USERS.staffA), again.ticket_id, {}), { code: 'TICKET_EXPIRED' });
    assert.equal((await callNextTicket(env.ds, { now }, staff(USERS.staffA), {})).queue_empty, true, "yesterday's tickets are not called");
  });

  it('unauthorised and cross-office actions are refused on the server', async () => {
    await takePublic({ office_id: OFFICE_A });
    const called = (await callNext()).body.ticket;

    // No token.
    assert.equal((await call(boardRoute, req('GET', '/queue'))).status, 401);
    assert.equal((await call(callNextRoute, req('POST', '/queue/call-next', { body: {} }))).status, 401);
    assert.equal((await call(staffIssueRoute, req('POST', '/queue/tickets', { body: {} }))).status, 401);
    assert.equal((await call(skipRoute, req('POST', `/queue/tickets/${called.ticket_id}/skip`, { body: {} }), ctx(called.ticket_id))).status, 401);
    // Executive: no queue access at all.
    assert.equal((await board(`?office_id=${OFFICE_A}`, tokens.executive)).status, 403);
    assert.equal((await callNext({ office_id: OFFICE_A }, tokens.executive)).status, 403);
    assert.equal((await takeStaff({ office_id: OFFICE_A }, tokens.executive)).status, 403);
    assert.equal((await skip(called.ticket_id, {}, tokens.executive)).status, 403);
    // Another office's staff and head.
    assert.equal((await board(`?office_id=${OFFICE_A}`, tokens.officeStaffB)).status, 403);
    assert.equal((await callNext({ office_id: OFFICE_A }, tokens.officeHeadB)).status, 403);
    assert.equal((await takeStaff({ office_id: OFFICE_A }, tokens.officeStaffB)).status, 403);
    assert.equal((await skip(called.ticket_id, {}, tokens.officeStaffB)).status, 403);
    // Their own office by default.
    assert.equal((await board('', tokens.officeStaffB)).body.office_id, OFFICE_B);
    // Super Admin: any office, but must say which.
    assert.equal((await board('', tokens.superAdmin)).status, 400);
    const adminBoard = await board(`?office_id=${OFFICE_A}`, tokens.superAdmin);
    assert.equal(adminBoard.status, 200);
    assert.equal(adminBoard.body.called[0].ticket_id, called.ticket_id);
    assert.equal((await takeStaff({ office_id: OFFICE_B }, tokens.superAdmin)).body.ticket_no, 'PUP-ACAD-001');
    assert.equal((await skip('not-a-uuid', {}, tokens.superAdmin)).status, 404);
    // The early Skip through the route.
    const early = await skip(called.ticket_id, {}, tokens.superAdmin);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'SKIP_TOO_EARLY');
    assert.ok(early.body.error.details.skippable_at);
    void admin;
  });
});

describe('CC059 handoff', () => {
  it('readNowServing gives the current ticket and the next three display numbers, nothing else', async () => {
    const now = clock('2026-11-13T04:00:00.000Z');
    assert.deepEqual(await readNowServing(env.ds, OFFICE_A, { now: now() }), { queue_date: '2026-11-13', current: null, next: [] });
    for (const lane of ['REGULAR', 'REGULAR', 'PRIORITY', 'REGULAR', 'REGULAR']) await issueAt(now, OFFICE_A, lane);
    await callNextTicket(env.ds, { now }, staff(USERS.staffA), {});
    const view = await readNowServing(env.ds, OFFICE_A, { now: now() });
    assert.deepEqual(view, { queue_date: '2026-11-13', current: 'PUP-OSAS-003', next: ['PUP-OSAS-001', 'PUP-OSAS-002', 'PUP-OSAS-004'] });
  });
});
