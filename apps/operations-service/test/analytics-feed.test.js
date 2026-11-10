// TT2: the analytics producer (all seven events, atomicity, privacy), the ANALYTICS delivery worker and the export.
// Real PostgreSQL (TEST_PG_URL); the Oversight receiver is a stand-in function here (the real receiver is exercised
// end to end in scripts/analytics-feed.test.mjs).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ROLES, dispatchOutbox, validateAnalyticsBatch, validateAnalyticsExportPage } from 'ccms-shared';
import { GET as exportRoute } from '../src/app/api/transactions/analytics-export/route.js';
import { runAnalyticsDispatch } from '../src/jobs/analytics-dispatch.js';
import { dispatchAnalyticsOutbox } from '../src/modules/analytics/dispatch.js';
import { recordAnalytics } from '../src/modules/analytics/producer.js';
import { runAutoClose } from '../src/modules/transaction/auto-close.js';
import { cancelTransaction } from '../src/modules/transaction/cancel.js';
import { completeTransaction } from '../src/modules/transaction/complete.js';
import { runComputePending } from '../src/modules/transaction/compute-pending.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { holdTransaction, resumeTransaction } from '../src/modules/transaction/hold.js';
import { startTransaction } from '../src/modules/transaction/start.js';
import { OFFICE_A, SERVICE_A, SERVICE_KEY, USERS, call, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const staffA = { id: USERS.staffA, role: ROLES.OFFICE_STAFF, officeId: OFFICE_A };
const headA = { id: USERS.headA, role: ROLES.OFFICE_HEAD, officeId: OFFICE_A };
const deps = (nowIso) => ({ core: createCoreClient(), identity: null, now: () => new Date(nowIso) });
const PRIVATE = {
  client_reference: '2023-00123-QC-0',
  client_email: 'juan.private@example.test',
  backdate: 'Backdate reason PRIVATE-B',
  hold: 'Hold reason PRIVATE-H',
  cancel: 'Cancel reason PRIVATE-C',
  disapproval: 'Disapproval reason PRIVATE-D',
};
const body = (over = {}) => ({ service_id: SERVICE_A, client_type: 'STUDENT', client_reference: PRIVATE.client_reference, client_email: PRIVATE.client_email, requirements_confirmed: true, ...over });
const events = (id) => env.ds.query('SELECT event_type, event_version, payload FROM analytics_outbox WHERE transaction_id = $1 ORDER BY event_version', [id]);
const allEvents = () => env.ds.query('SELECT event_id, transaction_id, event_type, event_version, payload, attempts, delivered_at, lease_token, last_error FROM analytics_outbox ORDER BY created_at, event_version');
const versionOf = async (id) => (await env.ds.query('SELECT analytics_event_version FROM transactions WHERE transaction_id = $1', [id]))[0].analytics_event_version;

/** A stand-in receiver: validates with the shared contract and keeps the highest version, like Oversight. */
function receiver({ fail = () => null } = {}) {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const failure = fail(calls.length);
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure) return new Response(JSON.stringify({ error: { code: 'X' } }), { status: failure });
    const valid = validateAnalyticsBatch(JSON.parse(init.body));
    for (const e of valid) {
      const old = store.get(e.snapshot.transaction_id);
      if (!old || e.snapshot.event_version > old.event_version) store.set(e.snapshot.transaction_id, e.snapshot);
    }
    return Response.json({ accepted: valid.length, applied: valid.length, ignored: 0 });
  };
  return { store, calls, fetchImpl };
}
const dispatch = (fetchImpl, extra = {}) => dispatchAnalyticsOutbox(env.ds, { oversightUrl: 'http://oversight.test', serviceKey: SERVICE_KEY, fetchImpl, ...extra });

describe('TT2 producer: one complete snapshot per transition, in the business transaction', () => {
  it('all seven event types, strictly increasing versions, authoritative held minutes and result', async () => {
    await env.ds.query('UPDATE transaction_settings SET hold_enabled = true');
    const t = await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), staffA, body());
    await holdTransaction(env.ds, staffA, t.transaction_id, { reason: PRIVATE.hold }, { now: () => new Date('2026-10-06T10:30:00+08:00') });
    await resumeTransaction(env.ds, deps('2026-10-06T11:30:00+08:00'), staffA, t.transaction_id);
    await completeTransaction(env.ds, deps('2026-10-06T12:00:00+08:00'), staffA, t.transaction_id, { outcome: 'DISAPPROVED', disapproval_reason: PRIVATE.disapproval, disapproval_notice_given: true });
    const list = await events(t.transaction_id);
    assert.deepEqual(list.map((e) => [e.event_type, e.event_version]), [
      ['TRANSACTION_STARTED', 1], ['TRANSACTION_HELD', 2], ['TRANSACTION_RESUMED', 3], ['TRANSACTION_COMPLETED', 4], ['TRANSACTION_RESULT_COMPUTED', 5],
    ]);
    assert.equal(list[1].payload.snapshot.status, 'ON_HOLD');
    assert.equal(list[2].payload.snapshot.held_minutes, 60, 'the persisted held total after resume');
    const completed = list[3].payload.snapshot;
    assert.deepEqual([completed.status, completed.outcome, completed.elapsed_working_minutes, completed.is_compliant, completed.variance_minutes], ['COMPLETED', 'DISAPPROVED', null, null, null], 'pending result stays null');
    const final = list[4].payload.snapshot;
    assert.equal(final.elapsed_working_minutes, 60, '2 h minus the 1 h hold');
    assert.equal(final.is_compliant, true);
    assert.equal(final.held_minutes, 60);
    assert.equal(final.ended_by_user_id, USERS.staffA);
    assert.equal(await versionOf(t.transaction_id), 5);
    const [row] = await env.ds.query('SELECT version FROM transactions WHERE transaction_id = $1', [t.transaction_id]);
    assert.equal(row.version, 5, 'the optimistic-lock version is unchanged by the analytics counter (1 + hold + resume + complete + result)');

    const c = await startTransaction(env.ds, deps('2026-10-06T13:00:00+08:00'), staffA, body());
    await cancelTransaction(env.ds, headA, c.transaction_id, { reason: PRIVATE.cancel });
    assert.deepEqual((await events(c.transaction_id)).map((e) => [e.event_type, e.event_version, e.payload.snapshot.status]),
      [['TRANSACTION_STARTED', 1, 'IN_PROGRESS'], ['TRANSACTION_CANCELLED', 2, 'CANCELLED']]);

    await env.ds.query('UPDATE transaction_settings SET auto_close_days_complex = 1');
    const old = await insertTransaction(env.ds, { started_at: new Date('2026-09-01T02:00:00Z') });
    const closed = await runAutoClose({ dataSource: env.ds, core: createCoreClient(), now: () => new Date('2026-10-06T10:00:00+08:00') });
    assert.equal(closed.closed, 1);
    const auto = await events(old.transaction_id);
    assert.deepEqual(auto.map((e) => [e.event_type, e.event_version, e.payload.snapshot.status, e.payload.snapshot.ended_at]), [['TRANSACTION_AUTO_CLOSED', 1, 'AUTO_CLOSED', null]]);
  });

  it('a backdated start recorded already completed: STARTED v1 and COMPLETED v2 carry the stored row; the result is v3', async () => {
    const t = await startTransaction(env.ds, deps('2026-10-07T10:00:00+08:00'), staffA, body({
      started_at: '2026-10-06T10:00:00+08:00', ended_at: '2026-10-06T11:00:00+08:00', backdate_reason: PRIVATE.backdate,
    }));
    const list = await events(t.transaction_id);
    assert.deepEqual(list.map((e) => [e.event_type, e.event_version, e.payload.snapshot.status]), [
      ['TRANSACTION_STARTED', 1, 'COMPLETED'], ['TRANSACTION_COMPLETED', 2, 'COMPLETED'], ['TRANSACTION_RESULT_COMPUTED', 3, 'COMPLETED'],
    ]);
    assert.equal(list[0].payload.snapshot.ended_at, '2026-10-06T03:00:00.000Z');
    assert.equal(list[0].payload.snapshot.is_backdated, true);
    assert.equal(list[2].payload.snapshot.elapsed_working_minutes, 60);
  });

  it('delayed result: Core down at completion leaves the result null; compute-pending later emits RESULT_COMPUTED from the updated row', async () => {
    const t = await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), staffA, body());
    env.core.setMode('down');
    await completeTransaction(env.ds, deps('2026-10-06T10:30:00+08:00'), staffA, t.transaction_id, { outcome: 'GRANTED' });
    let list = await events(t.transaction_id);
    assert.deepEqual(list.map((e) => e.event_type), ['TRANSACTION_STARTED', 'TRANSACTION_COMPLETED']);
    assert.equal(list[1].payload.snapshot.is_compliant, null);
    env.core.setMode('up');
    const run = await runComputePending({ dataSource: env.ds, core: createCoreClient() });
    assert.equal(run.computed, 1);
    list = await events(t.transaction_id);
    const last = list.at(-1);
    assert.equal(last.event_type, 'TRANSACTION_RESULT_COMPUTED');
    assert.equal(last.event_version, 3);
    assert.deepEqual([last.payload.snapshot.elapsed_working_minutes, last.payload.snapshot.is_compliant, last.payload.snapshot.outcome], [30, true, 'GRANTED']);
    const again = await runComputePending({ dataSource: env.ds, core: createCoreClient() });
    assert.equal(again.computed, 0);
    assert.equal((await events(t.transaction_id)).length, 3, 'no second result event');
  });

  it('a rolled-back change leaves neither the state change, the version nor the event', async () => {
    const t = await insertTransaction(env.ds, { started_by: USERS.staffA });
    await assert.rejects(env.ds.transaction(async (manager) => {
      await manager.query("UPDATE transactions SET status = 'CANCELLED', cancel_reason = 'x' WHERE transaction_id = $1", [t.transaction_id]);
      await recordAnalytics(manager, t.transaction_id, 'TRANSACTION_CANCELLED');
      throw new Error('boom');
    }), /boom/);
    assert.equal((await env.ds.query('SELECT status FROM transactions WHERE transaction_id = $1', [t.transaction_id]))[0].status, 'IN_PROGRESS');
    assert.equal(await versionOf(t.transaction_id), 0);
    assert.equal((await allEvents()).length, 0);
    // A refused start (one open transaction per staff) writes no event either.
    await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), { id: USERS.staffA2, role: ROLES.OFFICE_STAFF, officeId: OFFICE_A }, body());
    const before = (await allEvents()).length;
    await assert.rejects(startTransaction(env.ds, deps('2026-10-06T10:05:00+08:00'), { id: USERS.staffA2, role: ROLES.OFFICE_STAFF, officeId: OFFICE_A }, body()), /open transaction/);
    assert.equal((await allEvents()).length, before);
  });

  it('AC3: payloads hold no client identity, staff labels, IP or free-text reason, whatever the row contains', async () => {
    await env.ds.query('UPDATE transaction_settings SET hold_enabled = true');
    const t = await startTransaction(env.ds, deps('2026-10-07T10:00:00+08:00'), staffA, body({ started_at: '2026-10-06T10:00:00+08:00', backdate_reason: PRIVATE.backdate }), { ipAddress: '203.0.113.77' });
    await env.ds.query("UPDATE transactions SET started_by_name = 'Staff Name PRIVATE-N', started_by_position = 'Clerk PRIVATE-P' WHERE transaction_id = $1", [t.transaction_id]);
    await holdTransaction(env.ds, staffA, t.transaction_id, { reason: PRIVATE.hold }, { now: () => new Date('2026-10-07T10:30:00+08:00') });
    await resumeTransaction(env.ds, deps('2026-10-07T10:40:00+08:00'), staffA, t.transaction_id);
    await completeTransaction(env.ds, deps('2026-10-07T11:00:00+08:00'), staffA, t.transaction_id, { outcome: 'DISAPPROVED', disapproval_reason: PRIVATE.disapproval, disapproval_notice_given: true, ended_at: '2026-10-07T10:59:00+08:00', backdate_reason: PRIVATE.backdate });
    const c = await startTransaction(env.ds, deps('2026-10-07T12:00:00+08:00'), staffA, body());
    await cancelTransaction(env.ds, headA, c.transaction_id, { reason: PRIVATE.cancel });
    const exported = await call(exportRoute, req('GET', '/transactions/analytics-export', { key: SERVICE_KEY }));
    const texts = [...(await allEvents()).map((e) => JSON.stringify(e.payload)), JSON.stringify(exported.body)];
    for (const text of texts) {
      for (const secret of [...Object.values(PRIVATE), 'PRIVATE-N', 'PRIVATE-P', '203.0.113.77', 'Transcript of Records', 'Student Affairs']) {
        assert.ok(!text.includes(secret), `payload leaks ${secret}`);
      }
      for (const key of ['client_reference', 'client_email', 'reason', 'started_by_name', 'started_by_position', 'ip_address', 'service_name', 'office_name']) {
        assert.ok(!text.includes(`"${key}"`), `payload has key ${key}`);
      }
    }
    for (const e of await allEvents()) {
      assert.equal(e.payload.snapshot.registry_status, 'NONE');
      assert.equal(e.payload.snapshot.registry_miss_reason, null);
    }
  });
});

describe('TT2 ANALYTICS delivery', () => {
  it('delivers once with the service key to {Oversight}/api/analytics-events, then marks delivered', async () => {
    const t = await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), staffA, body());
    const r = receiver();
    for (const base of ['http://oversight.test', 'http://oversight.test/api/']) {
      await env.ds.query('UPDATE analytics_outbox SET delivered_at = NULL');
      r.calls.length = 0;
      assert.deepEqual(await dispatchAnalyticsOutbox(env.ds, { oversightUrl: base, serviceKey: SERVICE_KEY, fetchImpl: r.fetchImpl }), { claimed: 1, delivered: 1, failed: 0 });
      assert.equal(r.calls[0].url, 'http://oversight.test/api/analytics-events');
      assert.equal(r.calls[0].headers['x-service-key'], SERVICE_KEY);
    }
    assert.equal(r.store.get(t.transaction_id).event_version, 1);
    assert.deepEqual(await dispatch(r.fetchImpl), { claimed: 0, delivered: 0, failed: 0 }, 'nothing left');
  });

  it('a failure leaves the event retryable with backoff and a short error; a lost response is safe to resend', async () => {
    await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), staffA, body());
    for (const failure of [503, 'network']) {
      await env.ds.query('UPDATE analytics_outbox SET next_attempt_at = now()');
      const r = receiver({ fail: () => failure });
      assert.deepEqual(await dispatch(r.fetchImpl), { claimed: 1, delivered: 0, failed: 1 });
      const [e] = await allEvents();
      assert.equal(e.delivered_at, null);
      assert.equal(e.lease_token, null, 'lease released');
      assert.match(e.last_error, /Oversight (responded 503|could not be reached)/);
      assert.ok(!e.last_error.includes('{'), 'no response body is stored');
      assert.deepEqual(await dispatch(receiver().fetchImpl), { claimed: 0, delivered: 0, failed: 0 }, 'backoff: not due yet');
    }
    // Lost response: the receiver applied the batch but the answer never came back.
    await env.ds.query('UPDATE analytics_outbox SET next_attempt_at = now()');
    const r = receiver();
    const lost = async (url, init) => { await r.fetchImpl(url, init); throw new TypeError('socket hang up'); };
    assert.equal((await dispatch(lost)).failed, 1);
    await env.ds.query('UPDATE analytics_outbox SET next_attempt_at = now()');
    assert.equal((await dispatch(r.fetchImpl)).delivered, 1);
    assert.equal(r.store.size, 1);
    assert.equal((await allEvents())[0].attempts, 4);
  });

  it('a 400 batch is retried one event at a time so one bad event does not hold back the others', async () => {
    for (let i = 0; i < 3; i += 1) await recordAnalyticsFor(await insertTransaction(env.ds));
    const ids = (await allEvents()).map((e) => e.event_id);
    const r = receiver({ fail: (n) => (n === 1 || n === 3 ? 400 : null) });
    assert.deepEqual(await dispatch(r.fetchImpl), { claimed: 3, delivered: 2, failed: 1 });
    assert.equal(r.calls[0].body.events.length, 3);
    const failed = (await allEvents()).filter((e) => !e.delivered_at);
    assert.deepEqual(failed.map((e) => e.event_id), [ids[1]]);
  });

  it('bounds batch splitting and lets deferred good events progress ahead of rejected events', async () => {
    for (let i = 0; i < 3; i++) await recordAnalyticsFor(await insertTransaction(env.ds));
    const calls = [];
    const fetchImpl = async (_url, init) => {
      const { events } = JSON.parse(init.body);
      calls.push(events);
      return calls.length <= 2 ? new Response('{}', { status: 400 }) : Response.json({ accepted: events.length });
    };
    assert.deepEqual(await dispatch(fetchImpl, { maxFallbackEvents: 1 }), { claimed: 3, delivered: 0, failed: 3 });
    assert.equal(calls.length, 2, 'one rejected batch and at most one single-event attempt');
    const [{ deferred, leased }] = await env.ds.query("SELECT count(*) FILTER (WHERE last_error = 'Batch split pending')::int AS deferred, count(*) FILTER (WHERE lease_token IS NOT NULL)::int AS leased FROM analytics_outbox");
    assert.deepEqual({ deferred, leased }, { deferred: 2, leased: 0 });
    // Make the rejected row due, but keep its scheduled time later than the deferred rows.
    await env.ds.query("UPDATE analytics_outbox SET next_attempt_at = now() - interval '1 hour' WHERE last_error = 'Batch split pending'");
    await env.ds.query("UPDATE analytics_outbox SET next_attempt_at = now() WHERE last_error <> 'Batch split pending'");
    const retry = await dispatch(fetchImpl, { batchSize: 2 });
    assert.equal(retry.delivered, 2);
    assert(!calls[2].some((event) => event.event_id === calls[1][0].event_id), 'the rejected row cannot starve deferred events');
  });

  it('stops single-event fallback when the invocation time budget is spent', async () => {
    for (let i = 0; i < 2; i++) await recordAnalyticsFor(await insertTransaction(env.ds));
    let now = 0;
    let requests = 0;
    const fetchImpl = async () => { requests++; now = 20_000; return new Response('{}', { status: 400 }); };
    assert.deepEqual(await dispatch(fetchImpl, { clock: () => now }), { claimed: 2, delivered: 0, failed: 2 });
    assert.equal(requests, 1);
    assert((await allEvents()).every((event) => event.lease_token === null && event.last_error === 'Batch split pending'));
  });

  it('caps retry delay without numeric overflow after many failures', async () => {
    await recordAnalyticsFor(await insertTransaction(env.ds));
    await env.ds.query('UPDATE analytics_outbox SET attempts = 2000');
    assert.equal((await dispatch(async () => new Response('{}', { status: 503 }))).failed, 1);
    const [{ seconds, attempts }] = await env.ds.query('SELECT extract(epoch FROM next_attempt_at - now())::float AS seconds, attempts FROM analytics_outbox');
    assert.equal(attempts, 2001);
    assert(seconds > 3500 && seconds <= 3600);
  });

  it('overlapping dispatchers never share a claim; an expired lease is recovered; a stale run cannot mark the new claim', async () => {
    for (let i = 0; i < 6; i += 1) await recordAnalyticsFor(await insertTransaction(env.ds));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const seen = [];
    const slow = async (url, init) => { seen.push(...JSON.parse(init.body).events.map((e) => e.event_id)); await gate; return receiver().fetchImpl(url, init); };
    const a = dispatch(slow, { batchSize: 3 });
    const b = dispatch(slow, { batchSize: 3 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.delivered + rb.delivered, 6);
    assert.equal(new Set(seen).size, 6, 'no event sent twice');

    // A claim whose lease expired (the run died) is picked up again; the dead run's token no longer matches.
    await recordAnalyticsFor(await insertTransaction(env.ds));
    await env.ds.query("UPDATE analytics_outbox SET lease_token = gen_random_uuid(), lease_until = now() + interval '1 hour' WHERE delivered_at IS NULL");
    assert.equal((await dispatch(receiver().fetchImpl)).claimed, 0, 'a live lease is respected');
    await env.ds.query("UPDATE analytics_outbox SET lease_until = now() - interval '1 second' WHERE delivered_at IS NULL");
    assert.equal((await dispatch(receiver().fetchImpl)).delivered, 1);
  });

  it('audit and analytics delivery are independent: either can fail while the other delivers', async () => {
    await startTransaction(env.ds, deps('2026-10-06T10:00:00+08:00'), staffA, body());
    const ok = receiver();
    const down = async () => new Response('{}', { status: 503 });
    const auditOk = async () => new Response('{}', { status: 201 });
    assert.equal((await dispatch(down)).failed, 1);
    assert.equal((await dispatchOutbox(env.ds, { logsUrl: 'http://oversight.test/api', serviceKey: SERVICE_KEY, fetchImpl: auditOk })).sent, 1, 'audit still delivered');

    await env.ds.query('UPDATE audit_outbox SET sent_at = NULL, next_attempt_at = now()');
    await env.ds.query('UPDATE analytics_outbox SET next_attempt_at = now()');
    assert.equal((await dispatchOutbox(env.ds, { logsUrl: 'http://oversight.test/api', serviceKey: SERVICE_KEY, fetchImpl: down })).failed, 1);
    assert.equal((await dispatch(ok.fetchImpl)).delivered, 1, 'analytics still delivered');
  });

  it('the job helper skips cleanly without configuration', async () => {
    const previous = process.env.LOGS_SERVICE_URL;
    delete process.env.LOGS_SERVICE_URL;
    try {
      assert.deepEqual(await runAnalyticsDispatch({ dataSource: env.ds }), { skipped: true, reason: 'LOGS_SERVICE_URL and SERVICE_KEY are required', claimed: 0, delivered: 0, failed: 0 });
    } finally {
      if (previous !== undefined) process.env.LOGS_SERVICE_URL = previous;
    }
  });
});

async function recordAnalyticsFor(row) {
  await env.ds.transaction((manager) => recordAnalytics(manager, row.transaction_id, 'TRANSACTION_STARTED'));
}

describe('TT2 export (GET /api/transactions/analytics-export)', () => {
  const get = (query = '', opts = { key: SERVICE_KEY }) => call(exportRoute, req('GET', `/transactions/analytics-export${query}`, opts));

  it('AC5: service key only; a user token or a wrong key is 401', async () => {
    assert.equal((await get('', {})).status, 401);
    assert.equal((await get('', { key: 'wrong' })).status, 401);
    assert.equal((await get('', { token: tokens.superAdmin })).status, 401);
    assert.equal((await get('', { token: tokens.superAdmin, key: 'wrong' })).status, 401);
    assert.equal((await get()).status, 200);
  });

  it('pages every transaction in every state by an immutable key, with the live version, until next_cursor is null', async () => {
    const statuses = ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED'];
    const ids = [];
    for (const [i, status] of statuses.entries()) {
      const row = await insertTransaction(env.ds, {
        status,
        tracking_no: `PUP-OSAS-20261006-${i === 3 ? '9001' : `000${i}`}`,
        hold_started_at: status === 'ON_HOLD' ? new Date() : null,
        cancel_reason: status === 'CANCELLED' ? PRIVATE.cancel : null,
        ended_at: status === 'COMPLETED' ? new Date() : null,
        ended_by: status === 'COMPLETED' ? USERS.staffA : null,
        ...(i === 2 ? { elapsed_working_minutes: 10, is_compliant: false, variance_minutes: 5 } : {}),
      });
      ids.push(row.transaction_id);
    }
    await recordAnalyticsFor({ transaction_id: ids[0] });
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const r = await get(`?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(r.status, 200);
      const page = validateAnalyticsExportPage(r.body);
      seen.push(...page.items);
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor);
    assert.equal(pages, 2);
    assert.deepEqual(seen.map((s) => s.transaction_id), [...ids].sort());
    const byId = new Map(seen.map((s) => [s.transaction_id, s]));
    assert.equal(byId.get(ids[0]).event_version, 1, 'same counter as live delivery');
    assert.equal(byId.get(ids[1]).event_version, 0, 'existing rows export version 0');
    assert.deepEqual([byId.get(ids[3]).elapsed_working_minutes, byId.get(ids[3]).is_compliant], [null, null], 'pending stays null');
    assert.deepEqual([byId.get(ids[2]).is_compliant, byId.get(ids[2]).variance_minutes], [false, 5]);
    assert.deepEqual([...new Set(seen.map((s) => s.status))].sort(), ['AUTO_CLOSED', 'CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'ON_HOLD']);
    assert.equal((await allEvents()).length, 1, 'exporting writes nothing');
  });

  it('rejects bad limits, cursors and unknown parameters', async () => {
    for (const query of ['?limit=0', '?limit=501', '?limit=abc', '?cursor=not-a-cursor', `?cursor=${Buffer.from(JSON.stringify({ v: 1, after: 'x' })).toString('base64url')}`, '?status=COMPLETED']) {
      const r = await get(query);
      assert.equal(r.status, 400, query);
    }
    assert.equal((await get('?limit=500')).status, 200);
    const empty = await get(`?cursor=${Buffer.from(JSON.stringify({ v: 1, after: 'ffffffff-ffff-4fff-bfff-ffffffffffff' })).toString('base64url')}`);
    assert.deepEqual(empty.body, { schema_version: 1, items: [], next_cursor: null });
  });

  it('a randomly generated cursor id is accepted (opaque but strict)', async () => {
    const r = await get(`?cursor=${Buffer.from(JSON.stringify({ v: 1, after: randomUUID() })).toString('base64url')}`);
    assert.equal(r.status, 200);
  });
});
