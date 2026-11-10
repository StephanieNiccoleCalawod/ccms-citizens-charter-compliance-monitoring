// TT2: POST /api/analytics-events (service key, validation, conditional upsert), the restricted runtime role, and the
// resumable backfill (GET /api/jobs/analytics-backfill). Real PostgreSQL (TEST_PG_URL).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import {
  ANALYTICS_SCHEMA_VERSION,
  createDataSource,
  encodeAnalyticsCursor,
  setDataSource,
} from 'ccms-shared';
import { POST as ingestRoute } from '../src/app/api/analytics-events/route.js';
import { GET as backfillRoute } from '../src/app/api/jobs/analytics-backfill/route.js';
import { entities } from '../src/lib/entities/index.js';
import { runAnalyticsBackfill } from '../src/modules/analytics/backfill.js';
import { applyAnalyticsSnapshots } from '../src/modules/analytics/store.js';
import { SERVICE_KEY, call, req, roleUrl, setupTestEnv, tokens } from './helpers.js';

let env;
let writer; // a DataSource connected as the real runtime role ccms_logs_writer
before(async () => {
  env = await setupTestEnv();
  writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
  await writer.initialize();
});
after(async () => {
  await writer?.destroy();
  await env?.teardown();
});
beforeEach(async () => {
  await env.ds.query('DELETE FROM analytics_transactions');
  await env.ds.query('DELETE FROM analytics_backfill_state');
  setDataSource(writer); // the routes run as the runtime role, like the deployed service
});

const OFFICE = randomUUID();
function snapshot(over = {}) {
  return {
    transaction_id: randomUUID(),
    tracking_no: 'PUP-REG-20261015-0001',
    office_id: OFFICE,
    service_id: '11111111-1111-4111-8111-111111111111',
    service_code: 'PUP-REG-TOR-001',
    classification: 'COMPLEX',
    client_type: 'STUDENT',
    standard_days: 3,
    standard_hours: 0,
    standard_minutes: 0,
    started_at: '2026-10-15T02:00:00.000Z',
    ended_at: null,
    status: 'IN_PROGRESS',
    elapsed_working_minutes: null,
    is_compliant: null,
    variance_minutes: null,
    held_minutes: 0,
    is_backdated: false,
    started_outside_hours: false,
    registry_status: 'NONE',
    registry_miss_reason: null,
    outcome: null,
    started_by_user_id: '22222222-2222-4222-8222-222222222222',
    ended_by_user_id: null,
    counter_id: null,
    event_version: 1,
    ...over,
  };
}
const envelope = (snap, over = {}) => ({ event_id: randomUUID(), event_type: 'TRANSACTION_STARTED', schema_version: ANALYTICS_SCHEMA_VERSION, occurred_at: '2026-10-15T02:00:00.000Z', snapshot: snap, ...over });
const post = (body, { key = SERVICE_KEY, token, raw, headers } = {}) => call(ingestRoute, req('POST', '/analytics-events', { key, token, body: raw === undefined ? body : undefined, raw, headers }));
const rows = () => env.ds.query('SELECT * FROM analytics_transactions ORDER BY transaction_id');
const rowOf = async (id) => (await env.ds.query('SELECT * FROM analytics_transactions WHERE transaction_id = $1', [id]))[0];

describe('POST /api/analytics-events: authentication (AC5)', () => {
  it('needs the service key; a user token alone, a wrong key or no key is 401 and nothing is stored', async () => {
    const body = { events: [envelope(snapshot())] };
    assert.equal((await post(body, { key: null })).status, 401);
    assert.equal((await post(body, { key: 'wrong-key' })).status, 401);
    const userOnly = await post(body, { key: null, token: tokens.superAdmin });
    assert.equal(userOnly.status, 401);
    assert.equal(userOnly.body.error.code, 'INVALID_SERVICE_KEY');
    assert.equal((await post(body, { key: 'wrong', token: tokens.superAdmin })).status, 401);
    assert.equal((await rows()).length, 0);
    assert.equal((await post(body)).status, 200);
  });
});

describe('POST /api/analytics-events: validation before any write', () => {
  it('accepts an empty batch and exactly 500 events; rejects 501', async () => {
    assert.deepEqual((await post({ events: [] })).body, { accepted: 0, applied: 0, ignored: 0 });
    const five = Array.from({ length: 500 }, () => envelope(snapshot()));
    const ok = await post({ events: five });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { accepted: 500, applied: 500, ignored: 0 });
    const tooMany = await post({ events: [...five, envelope(snapshot())].map((e) => ({ ...e, event_id: randomUUID() })) });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, 'BATCH_TOO_LARGE');
    assert.equal((await rows()).length, 500);
  });

  it('AC3: rejects unknown or forbidden fields, invalid enums and versions; one bad event writes nothing', async () => {
    const cases = [
      { ...snapshot(), client_reference: '2023-00123-QC-0' },
      { ...snapshot(), client_email: 'x@example.test' },
      { ...snapshot(), cancel_reason: 'free text' },
      { ...snapshot(), started_by_name: 'Name' },
      { ...snapshot(), is_seeded: true },
      snapshot({ status: 'DONE' }),
      snapshot({ registry_status: 'MAYBE' }),
      snapshot({ registry_miss_reason: 'OLDER_ALUMNI' }), // a reason with registry_status NONE
      snapshot({ event_version: -1 }),
      snapshot({ event_version: 1.5 }),
      snapshot({ event_version: 2 ** 31 }),
      snapshot({ event_version: '3' }),
      snapshot({ is_compliant: true }), // partial result
      snapshot({ started_at: '2026-10-15 10:00' }),
    ];
    for (const bad of cases) {
      const r = await post({ events: [envelope(snapshot()), envelope(bad)] });
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 120));
      assert.ok(!JSON.stringify(r.body).includes('2023-00123'), 'errors never echo values');
    }
    assert.equal((await post({ events: [envelope(snapshot(), { extra: 1 })] })).status, 400);
    assert.equal((await post({ events: [envelope(snapshot(), { schema_version: 2 })] })).status, 400);
    assert.equal((await post({ events: [envelope(snapshot(), { event_type: 'TRANSACTION_DELETED' })] })).status, 400);
    assert.equal((await post({ events: [], more: true })).status, 400);
    assert.equal((await post(null, { raw: '{"events": [' })).status, 400);
    assert.equal((await post(null, { raw: '[]' })).status, 400);
    assert.equal((await rows()).length, 0, 'validate-before-write');
  });

  it('refuses a body over 1 MiB with 413 (declared or streamed) and writes nothing', async () => {
    const big = JSON.stringify({ events: [envelope(snapshot())], pad: 'x'.repeat(1024 * 1024) });
    const streamed = await post(null, { raw: big });
    assert.equal(streamed.status, 413);
    const declared = await post(null, { raw: '{"events":[]}', headers: { 'content-length': String(2 * 1024 * 1024) } });
    assert.equal(declared.status, 413);
    assert.equal((await rows()).length, 0);
  });
});

describe('analytics_transactions: highest event_version wins (AC1, AC2)', () => {
  it('a duplicate or older version changes nothing, timestamps included; a higher version replaces everything, nulls included', async () => {
    const id = randomUUID();
    const v2 = snapshot({ transaction_id: id, event_version: 2, status: 'COMPLETED', ended_at: '2026-10-15T03:00:00.000Z', ended_by_user_id: randomUUID(), elapsed_working_minutes: 60, is_compliant: true, variance_minutes: -120, outcome: 'GRANTED', counter_id: randomUUID() });
    assert.deepEqual((await post({ events: [envelope(v2)] })).body, { accepted: 1, applied: 1, ignored: 0 });
    const stored = await rowOf(id);
    for (const older of [v2, snapshot({ transaction_id: id, event_version: 1 })]) {
      assert.deepEqual((await post({ events: [envelope(older)] })).body, { accepted: 1, applied: 0, ignored: 1 });
      assert.deepEqual(await rowOf(id), stored, 'genuine no-op');
    }
    const v3 = snapshot({ transaction_id: id, event_version: 3, status: 'COMPLETED', ended_at: '2026-10-15T03:00:00.000Z', ended_by_user_id: v2.ended_by_user_id, outcome: null, counter_id: null });
    assert.deepEqual((await post({ events: [envelope(v3, { event_type: 'TRANSACTION_COMPLETED' })] })).body, { accepted: 1, applied: 1, ignored: 0 });
    const replaced = await rowOf(id);
    assert.deepEqual([replaced.event_version, replaced.elapsed_working_minutes, replaced.is_compliant, replaced.outcome, replaced.counter_id], [3, null, null, null, null]);
  });

  it('repeated transaction ids in one batch: the highest version is applied once, in any order; same-version conflicts are refused', async () => {
    const id = randomUUID();
    const batch = [3, 1, 5, 2, 5].map((v) => envelope(snapshot({ transaction_id: id, event_version: v, held_minutes: v })));
    assert.deepEqual((await post({ events: batch })).body, { accepted: 5, applied: 1, ignored: 4 });
    assert.equal((await rowOf(id)).event_version, 5);
    const conflict = await post({ events: [envelope(snapshot({ transaction_id: id, event_version: 9, held_minutes: 1 })), envelope(snapshot({ transaction_id: id, event_version: 9, held_minutes: 2 }))] });
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.error.code, 'CONFLICTING_DUPLICATE');
    assert.equal((await rowOf(id)).event_version, 5);
  });

  it('concurrent higher and lower deliveries converge on the highest version', async () => {
    const ids = Array.from({ length: 20 }, () => randomUUID());
    const versions = [1, 2, 3, 4, 5, 6, 7, 8];
    const sends = [];
    for (const v of versions.sort(() => Math.random() - 0.5)) {
      sends.push(post({ events: ids.map((id) => envelope(snapshot({ transaction_id: id, event_version: v, held_minutes: v }))) }));
    }
    const results = await Promise.all(sends);
    assert.ok(results.every((r) => r.status === 200));
    const stored = await rows();
    assert.equal(stored.length, 20);
    assert.ok(stored.every((r) => r.event_version === 8 && r.held_minutes === 8));
  });

  it('K16: is_seeded is derived from the final four-digit suffix (9001-9999), never trusted from input', async () => {
    const cases = { 'PUP-REG-20261015-9000': false, 'PUP-REG-20261015-9001': true, 'PUP-REG-20261015-9999': true, 'PUP-REG-20261015-0001': false,
      'PUP-REG-20261015-10000': false, 'PUP-REG-20261015-901': false, 'PUP-REG-20261015-9001a': false, '9001': false, 'PUP-REG-20261015-9001-x': false };
    const snaps = Object.keys(cases).map((tracking_no) => snapshot({ tracking_no }));
    await post({ events: snaps.map((s) => envelope(s)) });
    for (const s of snaps) assert.equal((await rowOf(s.transaction_id)).is_seeded, cases[s.tracking_no], s.tracking_no);
    assert.equal((await rowOf(snaps[1].transaction_id)).tracking_no, snaps[1].tracking_no, 'tracking number unchanged');
  });

  it('stores registry NONE, pending results and missing outcomes as received', async () => {
    const s = snapshot();
    await post({ events: [envelope(s)] });
    const r = await rowOf(s.transaction_id);
    assert.deepEqual([r.registry_status, r.registry_miss_reason, r.elapsed_working_minutes, r.is_compliant, r.variance_minutes, r.outcome], ['NONE', null, null, null, null, null]);
  });
});

describe('runtime role grants (TT2)', () => {
  const asWriter = async (sql) => {
    const client = new pg.Client({ connectionString: roleUrl(env.url, 'ccms_logs_writer') });
    await client.connect();
    try {
      await client.query('BEGIN');
      return await client.query(sql);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  };
  it('ccms_logs_writer can upsert analytics but not delete or truncate; audit_log grants are unchanged', async () => {
    await applyAnalyticsSnapshots(writer, [snapshot()]);
    for (const sql of ['DELETE FROM analytics_transactions', 'TRUNCATE analytics_transactions', 'DELETE FROM analytics_backfill_state', 'UPDATE audit_log SET action = action', 'DELETE FROM audit_log']) {
      await assert.rejects(asWriter(sql), (err) => err.code === '42501', sql);
    }
    const grants = await env.ds.query(
      `SELECT c.relname, pg_get_userbyid(a.grantee) AS grantee, a.privilege_type
         FROM pg_class c, aclexplode(c.relacl) a
        WHERE c.relname IN ('audit_log', 'analytics_transactions', 'analytics_backfill_state') AND a.grantee <> c.relowner
        ORDER BY 1, 2, 3`,
    );
    assert.deepEqual(grants.map((g) => `${g.relname}:${g.grantee}:${g.privilege_type}`), [
      'analytics_backfill_state:ccms_logs_writer:INSERT', 'analytics_backfill_state:ccms_logs_writer:SELECT', 'analytics_backfill_state:ccms_logs_writer:UPDATE',
      'analytics_transactions:ccms_logs_writer:INSERT', 'analytics_transactions:ccms_logs_writer:SELECT', 'analytics_transactions:ccms_logs_writer:UPDATE',
      'analytics_transactions:ccms_oversight_app:SELECT',
      'audit_log:ccms_logs_writer:INSERT', 'audit_log:ccms_logs_writer:SELECT', 'audit_log:ccms_oversight_app:SELECT',
    ]);
  });
});

// ---- Backfill ---------------------------------------------------------------------------------------------------

/** A stand-in for the Operations export over a fixed list of snapshots (validated keyset pages). */
function fakeOperations(source, { failOn = () => null } = {}) {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(init.headers['x-service-key'], SERVICE_KEY);
    const failure = failOn(calls);
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure) return new Response('{"error":{"secret":"do-not-store"}}', { status: failure });
    const u = new URL(url);
    assert.equal(u.pathname, '/api/transactions/analytics-export');
    const limit = Number(u.searchParams.get('limit'));
    const cursor = u.searchParams.get('cursor');
    const after = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()).after : null;
    const sorted = [...source()].sort((a, b) => (a.transaction_id < b.transaction_id ? -1 : 1)).filter((s) => !after || s.transaction_id > after);
    const items = sorted.slice(0, limit);
    return Response.json({ schema_version: 1, items, next_cursor: sorted.length > limit ? encodeAnalyticsCursor(items.at(-1).transaction_id) : null });
  };
  return { fetchImpl, get calls() { return calls; } };
}
const backfill = (ops, over = {}) => runAnalyticsBackfill({ dataSource: writer, operationsUrl: 'http://operations.test', serviceKey: SERVICE_KEY, fetchImpl: ops.fetchImpl, pageSize: 3, maxPages: Infinity, timeBudgetMs: Infinity, ...over });
const contentChecksum = async () => (await env.ds.query(
  "SELECT count(*)::int AS n, md5(string_agg(row(transaction_id, tracking_no, status, event_version, held_minutes, is_seeded, outcome)::text, '|' ORDER BY transaction_id)) AS h FROM analytics_transactions",
))[0];

describe('analytics backfill (AC4)', () => {
  const source = Array.from({ length: 10 }, (_, i) => snapshot({ event_version: i % 3, tracking_no: `PUP-REG-20261015-${i === 4 ? '9001' : `000${i}`}` }));

  it('two complete passes give the same row count and content; a run never goes past the end of a pass', async () => {
    const ops = fakeOperations(() => source);
    const first = await backfill(ops);
    assert.deepEqual({ ...first }, { ok: true, pages: 4, rows: 10, applied: 10, ignored: 0, pass_completed: true, resume_pending: false });
    const once = await contentChecksum();
    const second = await backfill(ops);
    assert.deepEqual([second.pass_completed, second.applied, second.ignored, second.rows], [true, 0, 10, 10]);
    assert.deepEqual(await contentChecksum(), once);
    assert.equal(once.n, 10);
    const [state] = await env.ds.query('SELECT passes_completed, next_cursor, lease_token FROM analytics_backfill_state');
    assert.deepEqual(state, { passes_completed: 2, next_cursor: null, lease_token: null });
  });

  it('a bounded run keeps its cursor; a failed page is recorded briefly and the next run resumes there', async () => {
    const ops = fakeOperations(() => source, { failOn: (n) => (n === 3 ? 503 : null) });
    const bounded = await backfill(ops, { maxPages: 1 });
    assert.deepEqual([bounded.pages, bounded.rows, bounded.pass_completed, bounded.resume_pending], [1, 3, false, true]);
    const failed = await backfill(ops);
    assert.deepEqual([failed.ok, failed.error, failed.pages], [false, 'EXPORT_REJECTED', 1]);
    const [state] = await env.ds.query('SELECT next_cursor, pass_rows, last_error, lease_token FROM analytics_backfill_state');
    assert.equal(state.last_error, 'Operations responded 503');
    assert.equal(state.lease_token, null);
    assert.equal(state.pass_rows, 6);
    assert.equal((await rows()).length, 6, 'committed pages stay');
    const resumed = await backfill(ops);
    assert.deepEqual([resumed.ok, resumed.rows, resumed.pass_completed], [true, 4, true]);
    assert.equal((await rows()).length, 10);
    const invalid = await backfill(fakeOperations(() => [{ ...source[0], client_email: 'x@example.test' }]));
    assert.deepEqual([invalid.ok, invalid.error], [false, 'EXPORT_INVALID']);
  });

  it('overlapping runs are refused while the lease is live; an expired lease is recovered', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const inner = fakeOperations(() => source);
    const slow = { fetchImpl: async (...args) => { await gate; return inner.fetchImpl(...args); } };
    const running = backfill(slow);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await backfill(inner), { ok: true, skipped: true, reason: 'ALREADY_RUNNING' });
    release();
    assert.equal((await running).pass_completed, true);

    await env.ds.query("UPDATE analytics_backfill_state SET lease_token = gen_random_uuid(), lease_until = now() - interval '1 second'");
    assert.equal((await backfill(inner)).pass_completed, true, 'a crashed run does not block forever');
  });

  it('a stale backfill page never regresses a newer live event; a row inserted behind the cursor arrives live', async () => {
    const id = source[5].transaction_id;
    await post({ events: [envelope({ ...source[5], event_version: 7, status: 'COMPLETED', ended_at: '2026-10-15T05:00:00.000Z', ended_by_user_id: randomUUID() })] });
    await backfill(fakeOperations(() => source));
    assert.deepEqual([(await rowOf(id)).event_version, (await rowOf(id)).status], [7, 'COMPLETED']);
    const late = snapshot({ transaction_id: '00000000-0000-4000-8000-000000000000' });
    await post({ events: [envelope(late)] });
    assert.equal((await rows()).length, 11);
  });

  it('the job route needs CRON_SECRET and answers counts only', async () => {
    const route = (auth) => backfillRoute(new Request('http://x.test/api/jobs/analytics-backfill', { headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    assert.equal((await route('Bearer x')).status, 401);
    process.env.CRON_SECRET = 'cron-secret';
    try {
      assert.equal((await route()).status, 401);
      assert.equal((await route('Bearer wrong')).status, 401);
      delete process.env.OPERATIONS_SERVICE_URL;
      const r = await route('Bearer cron-secret');
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { job: 'analytics-backfill', ok: false, skipped: true, reason: 'OPERATIONS_SERVICE_URL and SERVICE_KEY are required' });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
