// CC040: link a queue ticket at Start and record issue-to-Start waiting time. AC1 measured wait (recalled ticket, zero, rollback,
// double claim, stale/consumed/cross-office), AC2 compliance unchanged by the wait, AC3 Start without a ticket unchanged.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { GET as detailRoute } from '../src/app/api/transactions/[id]/route.js';
import { setQueueLimiter } from '../src/modules/queue/limit.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { computeAndStoreResult } from '../src/modules/transaction/complete.js';
import { loadTransactionRow } from '../src/modules/transaction/db.js';
import { QUEUE_SKIP_GRACE_MS, callNextTicket, issueTicket, skipTicket } from '../src/modules/queue/tickets.js';
import { queueWaitMinutes } from '../src/modules/queue/link.js';
import { NOT_IN_REGISTRY, OFFICE_A, OFFICE_B, SERVICE_A, USERS, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, staff, tokens } from './helpers.js';

let env;
let core;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
  core = createCoreClient();
});
after(async () => {
  setQueueLimiter(null);
  await env?.teardown();
});
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const body = (over = {}) => ({ service_id: SERVICE_A, client_type: 'EMPLOYEE', requirements_confirmed: true, ...over });
const start = (over = {}, token = tokens.officeStaffA) => call(startRoute, req('POST', '/transactions', { token, body: body(over) }));
const issue = (officeId = OFFICE_A, lane = 'REGULAR') => issueTicket(env.ds, { core }, { officeId, lane });
const ticketRow = async (ticketNo) => (await env.ds.query('SELECT * FROM queue_tickets WHERE ticket_no = $1', [ticketNo]))[0];
const ageTicket = (ticketNo, minutes, seconds = 0) =>
  env.ds.query("UPDATE queue_tickets SET issued_at = issued_at - make_interval(mins => $2, secs => $3) WHERE ticket_no = $1", [ticketNo, minutes, seconds]);
const txCount = async () => (await env.ds.query('SELECT count(*)::int AS n FROM transactions'))[0].n;
const lastAnalytics = async (id) => (await env.ds.query('SELECT payload FROM analytics_outbox WHERE transaction_id = $1 ORDER BY event_version DESC LIMIT 1', [id]))[0].payload;

describe('CC040 AC1: link at Start and measure the wait', () => {
  it('a Start with the called ticket records the wait from the original issue and serves the ticket', async () => {
    const issued = await issue();
    await ageTicket(issued.ticket_no, 12, 30);
    const { ticket } = await callNextTicket(env.ds, {}, staff(USERS.staffA), {});
    const r = await start({ queue_ticket_id: ticket.ticket_id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.queue_ticket_id, ticket.ticket_id);
    assert.equal(r.body.queue_ticket_no, issued.ticket_no);
    assert.equal(r.body.queue_wait_minutes, 12, 'whole completed minutes: 12:30 is 12');
    const row = await ticketRow(issued.ticket_no);
    assert.equal(row.status, 'SERVED');
    assert.equal(row.transaction_id, r.body.transaction_id);
    // The detail read and the analytics snapshot carry the duration (never the ticket).
    const detail = await call(detailRoute, req('GET', `/transactions/${r.body.transaction_id}`, { token: tokens.officeStaffA }), ctx(r.body.transaction_id));
    assert.equal(detail.body.queue_wait_minutes, 12);
    const event = await lastAnalytics(r.body.transaction_id);
    assert.equal(event.snapshot.queue_wait_minutes, 12);
    assert.ok(!JSON.stringify(event).includes(ticket.ticket_id) && !JSON.stringify(event).includes(issued.ticket_no));
    const [audit] = await env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' = 'TRANSACTION_STARTED'");
    assert.equal(audit.payload.after_value.queue_wait_minutes, 12);
    assert.equal(audit.payload.after_value.queue_ticket_no, issued.ticket_no);
  });

  it('a skipped-and-recalled ticket still measures from its original issue time', async () => {
    const issued = await issue();
    await ageTicket(issued.ticket_no, 20);
    const first = (await callNextTicket(env.ds, {}, staff(USERS.staffA), {})).ticket;
    const later = () => new Date(Date.now() + QUEUE_SKIP_GRACE_MS);
    await skipTicket(env.ds, { now: later }, staff(USERS.staffA), first.ticket_id, {});
    const recalled = (await callNextTicket(env.ds, {}, staff(USERS.staffA), {})).ticket;
    assert.equal(recalled.ticket_id, first.ticket_id);
    assert.equal(recalled.issued_at, (await ticketRow(issued.ticket_no)).issued_at.toISOString());
    const r = await start({ queue_ticket_id: recalled.ticket_id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.queue_wait_minutes, 20);
  });

  it('a wait under one minute is a measured zero, not null; a waiting (not yet called) ticket may be served directly', async () => {
    const issued = await issue();
    const r = await start({ queue_ticket_id: (await ticketRow(issued.ticket_no)).ticket_id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.queue_wait_minutes, 0);
    assert.strictEqual((await lastAnalytics(r.body.transaction_id)).snapshot.queue_wait_minutes, 0);
    assert.equal(queueWaitMinutes('2026-11-13T00:00:00Z', '2026-11-13T00:00:59.999Z'), 0);
    assert.equal(queueWaitMinutes('2026-11-13T00:00:00Z', '2026-11-13T00:01:00Z'), 1);
    assert.equal(queueWaitMinutes('2026-11-13T00:00:01Z', '2026-11-13T00:00:00Z'), null);
  });

  it('a failed Start leaves the ticket available (the claim rolls back)', async () => {
    await insertTransaction(env.ds, { started_by: USERS.staffA }); // staff A already has an open transaction
    const issued = await issue();
    const id = (await ticketRow(issued.ticket_no)).ticket_id;
    const r = await start({ queue_ticket_id: id });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'OPEN_TRANSACTION_EXISTS');
    const row = await ticketRow(issued.ticket_no);
    assert.deepEqual([row.status, row.transaction_id, row.served_at], ['WAITING', null, null]);
    assert.equal((await start({ queue_ticket_id: id }, tokens.officeStaffA2)).status, 201, 'another staff can still use it');
  });

  it('concurrent Starts link a ticket only once', async () => {
    const issued = await issue();
    const id = (await ticketRow(issued.ticket_no)).ticket_id;
    const results = await Promise.all([start({ queue_ticket_id: id }, tokens.officeStaffA), start({ queue_ticket_id: id }, tokens.officeStaffA2), start({ queue_ticket_id: id }, tokens.officeHeadA)]);
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => [r.status, r.body?.error?.code])));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'QUEUE_TICKET_USED' && r.body.error.details.queue_ticket_id));
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM transactions WHERE queue_ticket_id = $1', [id]))[0].n, 1);
    assert.equal(await txCount(), 1);
  });

  it('a consumed, stale or cross-office ticket is refused with a field error and nothing is saved', async () => {
    const used = await issue();
    const usedId = (await ticketRow(used.ticket_no)).ticket_id;
    assert.equal((await start({ queue_ticket_id: usedId })).status, 201);
    const again = await start({ queue_ticket_id: usedId }, tokens.officeStaffA2);
    assert.deepEqual([again.status, again.body.error.code], [409, 'QUEUE_TICKET_USED']);

    const stale = await issue();
    await env.ds.query("UPDATE queue_tickets SET queue_date = queue_date - 1, issued_at = issued_at - interval '1 day' WHERE ticket_no = $1", [stale.ticket_no]);
    const old = await start({ queue_ticket_id: (await ticketRow(stale.ticket_no)).ticket_id }, tokens.officeStaffA2);
    assert.deepEqual([old.status, old.body.error.code], [409, 'QUEUE_TICKET_EXPIRED']);
    assert.ok(old.body.error.details.queue_ticket_id);

    const other = await issue(OFFICE_B);
    const cross = await start({ queue_ticket_id: (await ticketRow(other.ticket_no)).ticket_id }, tokens.officeStaffA2);
    assert.deepEqual([cross.status, cross.body.error.code], [400, 'QUEUE_TICKET_INVALID']);
    assert.equal((await ticketRow(other.ticket_no)).status, 'WAITING');

    const unknown = await start({ queue_ticket_id: '00000000-0000-4000-8000-0000000000ff' }, tokens.officeStaffA2);
    assert.deepEqual([unknown.status, unknown.body.error.code], [400, 'QUEUE_TICKET_INVALID']);
    const malformed = await start({ queue_ticket_id: 'REG-014' }, tokens.officeStaffA2);
    assert.equal(malformed.status, 400);
    assert.ok(malformed.body.error.details.queue_ticket_id);
    assert.equal(await txCount(), 1);
  });

  it('an effective start earlier than the issue is refused for the link, and the ticket-free Start still works', async () => {
    const issued = await issue();
    const id = (await ticketRow(issued.ticket_no)).ticket_id;
    const startedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const backdated = { started_at: startedAt, backdate_reason: 'Entered late after a network outage' };
    const refused = await start({ ...backdated, queue_ticket_id: id });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'QUEUE_TICKET_AFTER_START');
    assert.ok(refused.body.error.details.queue_ticket_id);
    assert.equal((await ticketRow(issued.ticket_no)).status, 'WAITING');
    const without = await start(backdated);
    assert.equal(without.status, 201, JSON.stringify(without.body));
    assert.deepEqual([without.body.queue_ticket_id, without.body.queue_wait_minutes], [null, null]);
  });

  it('Skip after the ticket was linked at Start is refused (Skip racing Start)', async () => {
    await issue();
    const called = (await callNextTicket(env.ds, {}, staff(USERS.staffA), {})).ticket;
    const later = () => new Date(Date.now() + QUEUE_SKIP_GRACE_MS);
    const [started, skipped] = await Promise.allSettled([start({ queue_ticket_id: called.ticket_id }), skipTicket(env.ds, { now: later }, staff(USERS.staffA2), called.ticket_id, {})]);
    const startOk = started.status === 'fulfilled' && started.value.status === 201;
    const skipOk = skipped.status === 'fulfilled';
    assert.ok(startOk || skipOk, 'one of them wins');
    if (startOk && !skipOk) assert.equal(skipped.reason.code, 'TICKET_NOT_CALLED');
    if (startOk && skipOk) assert.equal((await ticketRow(called.ticket_no)).status, 'SERVED', 'the skip ran first and the ticket was then served while waiting');
    if (!startOk) assert.equal(started.value.status, 201, JSON.stringify(started.value.body));
    // After the Start, Skip is always refused.
    await assert.rejects(skipTicket(env.ds, { now: later }, staff(USERS.staffA2), called.ticket_id, {}), { code: 'TICKET_NOT_CALLED' });
  });
});

describe('CC040 AC2: compliance does not depend on the queue wait', () => {
  it('the same service and timing give identical deadlines and results with and without a wait', async () => {
    const issued = await issue();
    const ticketId = (await ticketRow(issued.ticket_no)).ticket_id;
    const times = { started_at: new Date('2026-11-10T01:15:00.000Z'), ended_at: new Date('2026-11-12T07:40:00.000Z'), status: 'COMPLETED', ended_by: USERS.staffA };
    const plain = await insertTransaction(env.ds, times);
    const queued = await insertTransaction(env.ds, { ...times, queue_ticket_id: ticketId, queue_wait_minutes: 47 });
    for (const row of [plain, queued]) await computeAndStoreResult(env.ds, core, await loadTransactionRow(env.ds, row.transaction_id), { system: true });
    const pick = (r) => [r.elapsed_working_minutes, r.is_compliant, r.variance_minutes, r.held_minutes];
    const a = await loadTransactionRow(env.ds, plain.transaction_id);
    const b = await loadTransactionRow(env.ds, queued.transaction_id);
    assert.notEqual(a.elapsed_working_minutes, null);
    assert.deepEqual(pick(b), pick(a));
    const deadlines = env.core.callsTo('POST', '/deadline').map((c) => JSON.stringify(c.body));
    assert.equal(deadlines.length, 2);
    assert.equal(deadlines[0], deadlines[1], 'Core is asked for the same deadline');
    assert.equal(b.queue_wait_minutes, 47);
  });
});

describe('CC040 AC3: Start without a ticket is unchanged', () => {
  it('the existing body starts normally and the ticket and wait stay null (and out of the analytics payload)', async () => {
    const r = await start({ client_type: 'STUDENT', ...NOT_IN_REGISTRY });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.queue_ticket_id, r.body.queue_ticket_no, r.body.queue_wait_minutes], [null, null, null]);
    const [row] = await env.ds.query('SELECT queue_ticket_id, queue_wait_minutes FROM transactions WHERE transaction_id = $1', [r.body.transaction_id]);
    assert.deepEqual([row.queue_ticket_id, row.queue_wait_minutes], [null, null]);
    const event = await lastAnalytics(r.body.transaction_id);
    assert.equal(Object.hasOwn(event.snapshot, 'queue_wait_minutes'), false, 'left out while null, so an older Oversight accepts it');
    assert.equal((await start({ queue_ticket_id: null }, tokens.officeStaffA2)).status, 201);
    assert.equal((await start({ queue_ticket_id: '' }, tokens.officeHeadA)).status, 201);
  });
});
