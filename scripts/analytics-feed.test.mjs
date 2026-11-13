// TT2 end to end on two disposable databases (TEST_PG_URL, loopback only): the real Operations producer, delivery worker
// and export against the real Oversight receiver and backfill, with Oversight running as its restricted runtime role.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ROLES, createDataSource, requireServiceKey, setDataSource } from 'ccms-shared';
import { DEFAULT_TEST_PG_URL, createTestDatabase } from 'ccms-shared/testing';
import { afterSync as opsAfterSync } from '../apps/operations-service/src/lib/after-sync.js';
import { entities as opsEntities } from '../apps/operations-service/src/lib/entities/index.js';
import { dispatchAnalyticsOutbox } from '../apps/operations-service/src/modules/analytics/dispatch.js';
import { exportAnalyticsPage, parseExportQuery } from '../apps/operations-service/src/modules/analytics/export.js';
import { issueTicket } from '../apps/operations-service/src/modules/queue/tickets.js';
import { completeTransaction } from '../apps/operations-service/src/modules/transaction/complete.js';
import { createCoreClient } from '../apps/operations-service/src/modules/transaction/core-client.js';
import { holdTransaction, resumeTransaction } from '../apps/operations-service/src/modules/transaction/hold.js';
import { startTransaction } from '../apps/operations-service/src/modules/transaction/start.js';
import { setSwitchGate } from '../apps/operations-service/src/modules/transaction/switches.js';
import { startFakeCore } from '../apps/operations-service/test/fake-core.js';
import { POST as ingestRoute } from '../apps/oversight-service/src/app/api/analytics-events/route.js';
import { afterSync as ovsAfterSync } from '../apps/oversight-service/src/lib/after-sync.js';
import { entities as ovsEntities } from '../apps/oversight-service/src/lib/entities/index.js';
import { runAnalyticsBackfill } from '../apps/oversight-service/src/modules/analytics/backfill.js';

if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env.TEST_PG_URL ?? DEFAULT_TEST_PG_URL).hostname)) {
  throw new Error('TT2 end-to-end tests require a disposable loopback PostgreSQL server');
}

const SERVICE_KEY = 'test-service-key-0123456789';
const OFFICE = '0a000000-0000-4000-8000-000000000001';
const SERVICE = '0b000000-0000-4000-8000-000000000001';
const STAFF = ['0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000004'];
const staff = (i) => ({ id: STAFF[i], role: ROLES.OFFICE_STAFF, officeId: OFFICE });

let ops;
let ovs;
let writer;
let core;
before(async () => {
  const switchState = { STAFF_HOLD_RESUME: true };
  setSwitchGate({ all: async () => ({ ...switchState }), isEnabled: async (key) => switchState[key] === true, reset() {} });
  process.env.SERVICE_KEY = SERVICE_KEY;
  process.env.LOGS_WRITER_PASSWORD = 'tt2-e2e-writer-pw';
  process.env.OVERSIGHT_APP_PASSWORD = 'tt2-e2e-app-pw';
  ops = await createTestDatabase({ entities: opsEntities, afterSync: opsAfterSync });
  ovs = await createTestDatabase({ entities: ovsEntities, afterSync: ovsAfterSync });
  const url = new URL(ovs.url);
  url.username = 'ccms_logs_writer';
  url.password = 'tt2-e2e-writer-pw';
  writer = createDataSource({ url: url.toString(), entities: ovsEntities, synchronize: false });
  await writer.initialize();
  setDataSource(writer); // the Oversight route runs as the runtime role
  core = await startFakeCore({ serviceKey: SERVICE_KEY });
  core.addOffice({ office_id: OFFICE, office_code: 'PUP-REG', office_name: 'Registrar' });
  core.addService({ service_id: SERVICE, office_id: OFFICE, office_code: 'PUP-REG', service_code: 'PUP-REG-TOR-001', service_name: 'Transcript', classification: 'SIMPLE',
    standards: [{ from: '2025-01-01', to: null, standard_id: '0d000000-0000-4000-8000-000000000001', days: 0, hours: 1, minutes: 0 }] });
});
after(async () => {
  setSwitchGate(null);
  setDataSource(null);
  await writer?.destroy();
  await core?.close();
  await ops?.drop();
  await ovs?.drop();
});
beforeEach(async () => {
  // Children of transactions first (transaction_emails, CC045 transaction_receipts, CC057 service_ratings all have a foreign key to it).
  for (const table of ['analytics_outbox', 'audit_outbox', 'transaction_emails', 'transaction_receipts', 'service_ratings', 'transactions', 'tracking_sequences', 'queue_tickets', 'queue_sequences']) await ops.dataSource.query(`DELETE FROM ${table}`);
  await ops.dataSource.query('UPDATE transaction_settings SET hold_enabled = true');
  await ovs.dataSource.query('DELETE FROM analytics_transactions');
  await ovs.dataSource.query('DELETE FROM analytics_backfill_state');
});

const deps = (iso) => ({ core: createCoreClient({ baseUrl: `${core.url}/api`, serviceKey: SERVICE_KEY }), identity: null, now: () => new Date(iso) });
const body = {
  service_id: SERVICE,
  client_type: 'STUDENT',
  client_reference: '2023-00001-CM-0',
  client_email: 'e2e@example.test',
  requirements_confirmed: true,
  registry_not_found: true,
  registry_miss_reason: 'NEW_ENROLLEE',
};
// Delivery goes straight to the real Oversight route handler (service key in the request, as in production).
const toOversight = (url, init) => ingestRoute(new Request(url, init));
const deliver = () => dispatchAnalyticsOutbox(ops.dataSource, { oversightUrl: 'http://oversight.test', serviceKey: SERVICE_KEY, fetchImpl: toOversight });
// The Operations export, called the way its route does it (service key first).
const exportFetch = (hook = async () => {}) => {
  return async (url, init) => {
    const request = new Request(url, init);
    requireServiceKey(request);
    const page = await exportAnalyticsPage(ops.dataSource, parseExportQuery(new URL(url).searchParams));
    await hook(page);
    return Response.json(page);
  };
};
const backfill = (fetchImpl, over = {}) => runAnalyticsBackfill({ dataSource: writer, operationsUrl: 'http://operations.test/api', serviceKey: SERVICE_KEY, fetchImpl, pageSize: 2, maxPages: Infinity, timeBudgetMs: Infinity, ...over });
const projection = () => ovs.dataSource.query('SELECT * FROM analytics_transactions ORDER BY transaction_id');
const COMPARED = ['transaction_id', 'tracking_no', 'status', 'event_version', 'held_minutes', 'elapsed_working_minutes', 'is_compliant', 'variance_minutes', 'outcome', 'ended_by_user_id'];
async function assertConverged() {
  const truth = (await exportAnalyticsPage(ops.dataSource, { limit: 500 })).items;
  const stored = await projection();
  assert.equal(stored.length, truth.length, 'one projection row per transaction');
  for (const [i, t] of truth.entries()) {
    for (const field of COMPARED) assert.deepEqual(stored[i][field], t[field], `${t.transaction_id} ${field}`);
  }
}

describe('TT2 end to end', () => {
  it('AC1: start, deliver, complete and compute: exactly one row with the final status, result and highest version', async () => {
    const t = await startTransaction(ops.dataSource, deps('2026-10-06T10:00:00+08:00'), staff(0), body);
    assert.equal((await deliver()).delivered, 1);
    assert.equal((await projection())[0].status, 'IN_PROGRESS');
    await completeTransaction(ops.dataSource, deps('2026-10-06T10:40:00+08:00'), staff(0), t.transaction_id, { outcome: 'GRANTED' });
    assert.equal((await deliver()).delivered, 2);
    const rows = await projection();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].status, rows[0].event_version, rows[0].elapsed_working_minutes, rows[0].is_compliant, rows[0].variance_minutes, rows[0].outcome, rows[0].is_seeded],
      ['COMPLETED', 3, 40, true, -20, 'GRANTED', false]);
    // AC2: delivering everything again changes nothing.
    await ops.dataSource.query('UPDATE analytics_outbox SET delivered_at = NULL');
    const before = await projection();
    assert.equal((await deliver()).delivered, 3);
    assert.deepEqual(await projection(), before);
  });

  it('AC4: backfill with live updates during the pass converges, never regresses, and a second pass changes nothing', async () => {
    const actor = staff(0);
    const issued = await issueTicket(ops.dataSource, deps('2026-10-06T09:48:00+08:00'), { officeId: OFFICE, lane: 'REGULAR' });
    const [{ ticket_id }] = await ops.dataSource.query('SELECT ticket_id FROM queue_tickets WHERE ticket_no = $1', [issued.ticket_no]);
    const { transaction_id } = await startTransaction(ops.dataSource, deps('2026-10-06T10:00:00+08:00'), actor, { ...body, queue_ticket_id: ticket_id });
    for (let i = 1; i < 4; i += 1) await startTransaction(ops.dataSource, deps(`2026-10-06T1${i}:00:00+08:00`), staff(i), body);
    // Pre-existing history: rows with version 0 (as before the TT2 migration) and no outbox events.
    await ops.dataSource.query('UPDATE transactions SET analytics_event_version = 0');
    await ops.dataSource.query('DELETE FROM analytics_outbox');
    // Simulate a pre-CC040 export for the ticketed row, then deliver the newer hold before backfill ingests the page.
    const fetchImpl = exportFetch(async (page) => {
      const stale = page.items.find((row) => row.transaction_id === transaction_id);
      if (!stale) return;
      delete stale.queue_wait_minutes;
      await holdTransaction(ops.dataSource, actor, transaction_id, { reason: 'private hold reason' }, { now: () => new Date('2026-10-06T14:30:00+08:00') });
      await deliver();
    });
    const first = await backfill(fetchImpl);
    assert.equal(first.pass_completed, true);
    const held = (await projection()).find((r) => r.transaction_id === transaction_id);
    assert.deepEqual([held.status, held.event_version, held.queue_wait_minutes], ['ON_HOLD', 1, 12], 'the live update survives the stale page');
    await assertConverged();

    await resumeTransaction(ops.dataSource, deps('2026-10-06T15:00:00+08:00'), actor, transaction_id);
    await deliver();
    await assertConverged();

    const count = (await projection()).length;
    const content = JSON.stringify((await projection()).map((r) => COMPARED.map((f) => r[f])));
    const second = await backfill(exportFetch());
    assert.deepEqual([second.pass_completed, second.applied, second.rows], [true, 0, 4]);
    assert.equal((await projection()).find((r) => r.transaction_id === transaction_id).queue_wait_minutes, 12);
    assert.equal((await projection()).length, count);
    assert.equal(JSON.stringify((await projection()).map((r) => COMPARED.map((f) => r[f]))), content);
    const leaked = JSON.stringify(await projection());
    for (const secret of ['2023-00001', 'e2e@example.test', 'private hold reason']) assert.ok(!leaked.includes(secret), secret);
  });

  it('a backfill interrupted mid-pass resumes and converges; backfill never writes to Operations', async () => {
    for (let i = 0; i < 4; i += 1) await startTransaction(ops.dataSource, deps(`2026-10-07T1${i}:00:00+08:00`), staff(i), body);
    const opsBefore = await ops.dataSource.query('SELECT transaction_id, version, analytics_event_version, status FROM transactions ORDER BY 1');
    const outboxBefore = (await ops.dataSource.query('SELECT count(*)::int AS n FROM analytics_outbox'))[0].n;
    const auditBefore = (await ops.dataSource.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n;
    let fail = true;
    const flaky = async (url, init) => {
      if (fail && new URL(url).searchParams.get('cursor')) { fail = false; throw new TypeError('connection reset'); }
      return exportFetch()(url, init);
    };
    const interrupted = await backfill(flaky);
    assert.deepEqual([interrupted.ok, interrupted.error, interrupted.rows], [false, 'EXPORT_UNREACHABLE', 2]);
    const resumed = await backfill(flaky);
    assert.deepEqual([resumed.ok, resumed.rows, resumed.pass_completed], [true, 2, true]);
    await assertConverged();
    assert.deepEqual(await ops.dataSource.query('SELECT transaction_id, version, analytics_event_version, status FROM transactions ORDER BY 1'), opsBefore);
    assert.equal((await ops.dataSource.query('SELECT count(*)::int AS n FROM analytics_outbox'))[0].n, outboxBefore);
    assert.equal((await ops.dataSource.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n, auditBefore, 'no audit copies');
  });
});
