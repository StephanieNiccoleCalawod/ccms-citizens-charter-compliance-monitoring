import { randomUUID } from 'node:crypto';
import { ANALYTICS_SOURCE_COLUMNS, buildAnalyticsEvent, isSeededTrackingNo, recordAudit, serviceApiBase, snapshotFromTransactionRow } from 'ccms-shared';
import { ALGORITHM_VERSION } from './config.js';
import { businessRecord, planDigest } from './planner.js';
import { sha256, uuidFromName } from './random.js';

// Sprint 6 TT1 writer: the dedicated import path. It never calls the Start/Complete endpoints or modules, never touches
// tracking_sequences, queues no email (no transaction_emails row, receipt status NONE, no client email), sends nothing to
// FMS/SCMS, writes no calendar data, and writes no per-row business audit. It does publish every row to the TT2 analytics
// outbox (the supported path) and appends exactly one "Historical records import" summary audit per successful run.
//
// One Operations database transaction per run, serialized by an advisory lock. Cross-database cleanup of the Oversight
// projection uses Oversight's own service-key command after the Operations commit; it is retried by any later run.

export const SEED_LOCK = [43436, 700];
const RESERVED = String.raw`-[0-9]{8}-9[0-9]{3}$`;
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

export class SeedWriteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SeedWriteError';
    this.details = details;
  }
}

/** Rows in the reserved range: owned (listed in seeded_transactions, not removed) vs unowned (an ambiguity). */
export async function reservedRangeState(queryable) {
  const [state] = await queryable.query(
    `SELECT count(*) FILTER (WHERE s.transaction_id IS NOT NULL)::int AS owned,
            count(*) FILTER (WHERE s.transaction_id IS NULL AND right(t.tracking_no, 4)::int >= 9001)::int AS unowned
       FROM transactions t
       LEFT JOIN seeded_transactions s ON s.transaction_id = t.transaction_id AND s.removed_at IS NULL
      WHERE t.tracking_no ~ $1`,
    [RESERVED],
  );
  const [pending] = await queryable.query('SELECT count(*)::int AS n FROM seeded_transactions WHERE removed_at IS NOT NULL AND oversight_purged_at IS NULL');
  return { owned: state.owned, unowned: state.unowned, pendingOversightPurge: pending.n };
}

/** Deletes every owned seeded row (and its outbox/emails), keeping the provenance rows for the Oversight purge. */
async function removeOwned(manager, runId) {
  const owned = await manager.query('SELECT transaction_id FROM seeded_transactions WHERE removed_at IS NULL ORDER BY transaction_id FOR UPDATE');
  const ids = owned.map((r) => r.transaction_id);
  if (!ids.length) return { removed: 0, outbox: 0 };
  // Lock the rows first so a live Complete/Cancel on a seeded open row cannot interleave.
  await manager.query('SELECT transaction_id FROM transactions WHERE transaction_id = ANY($1::uuid[]) ORDER BY transaction_id FOR UPDATE', [ids]);
  const outbox = rowsOf(await manager.query('DELETE FROM analytics_outbox WHERE transaction_id = ANY($1::uuid[]) RETURNING event_id', [ids])).length;
  await manager.query('DELETE FROM transaction_emails WHERE transaction_id = ANY($1::uuid[])', [ids]);
  const removed = rowsOf(await manager.query('DELETE FROM transactions WHERE transaction_id = ANY($1::uuid[]) RETURNING transaction_id', [ids])).length;
  await manager.query('UPDATE seeded_transactions SET removed_at = now(), removed_by_run = $2 WHERE transaction_id = ANY($1::uuid[])', [ids, runId]);
  // Audit history (append-only) is never touched: entries a person made on a seeded open row stay.
  return { removed, outbox };
}

const INSERT_COLUMNS = [
  ['transaction_id', 'uuid'], ['tracking_no', 'varchar(60)'], ['service_id', 'uuid'], ['service_code', 'text'], ['service_name', 'text'],
  ['office_id', 'uuid'], ['office_code', 'varchar(20)'], ['office_name', 'text'], ['service_classification', 'varchar(20)'],
  ['standard_id', 'uuid'], ['standard_duration_days', 'int'], ['standard_duration_hours', 'int'], ['standard_duration_minutes', 'int'],
  ['client_type', 'varchar(20)'], ['started_at', 'timestamptz'], ['started_by', 'uuid'], ['started_by_name', 'varchar(200)'],
  ['started_by_position', 'varchar(100)'], ['ended_at', 'timestamptz'], ['ended_by', 'uuid'], ['status', 'varchar(20)'],
  ['elapsed_working_minutes', 'int'], ['is_compliant', 'boolean'], ['variance_minutes', 'int'],
  ['registry_student_number', 'varchar(30)'], ['registry_status', 'varchar(12)'], ['registry_miss_reason', 'varchar(20)'],
];

function toRecord(row, runId) {
  const record = {};
  for (const [name] of INSERT_COLUMNS) record[name] = row[name] ?? null;
  record.transaction_id = uuidFromName(`${runId}|${row.tracking_no}`);
  return record;
}

async function insertRows(manager, records) {
  const names = INSERT_COLUMNS.map(([n]) => n);
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    // No contact data, no email, no reference, receipt NONE, never backdated or outside hours; analytics version 1 (the
    // single snapshot published below).
    await manager.query(
      `INSERT INTO transactions (${names.join(', ')}, counter_id, client_reference, client_email, is_backdated, started_outside_hours,
                                 receipt_email_status, held_minutes, analytics_event_version, version)
       SELECT ${names.map((n) => `x.${n}`).join(', ')}, NULL, NULL, NULL, false, false, 'NONE', 0, 1, 1
         FROM jsonb_to_recordset($1::jsonb) AS x(${INSERT_COLUMNS.map(([n, t]) => `${n} ${t}`).join(', ')})`,
      [JSON.stringify(chunk)],
    );
  }
}

async function publishAnalytics(manager, ids, occurredAt) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await manager.query(`SELECT ${ANALYTICS_SOURCE_COLUMNS.join(', ')} FROM transactions WHERE transaction_id = ANY($1::uuid[]) ORDER BY transaction_id`, [chunk]);
    const events = rows.map((row) => buildAnalyticsEvent({
      eventType: row.status === 'COMPLETED' ? 'TRANSACTION_RESULT_COMPUTED' : 'TRANSACTION_STARTED',
      snapshot: snapshotFromTransactionRow(row),
      eventId: randomUUID(),
      occurredAt,
    }));
    await manager.query(
      `INSERT INTO analytics_outbox (event_id, transaction_id, event_version, event_type, payload)
       SELECT x.event_id, x.transaction_id, x.event_version, x.event_type, x.payload
         FROM jsonb_to_recordset($1::jsonb) AS x(event_id uuid, transaction_id uuid, event_version int, event_type varchar(40), payload jsonb)`,
      [JSON.stringify(events.map((e) => ({ event_id: e.event_id, transaction_id: e.snapshot.transaction_id, event_version: e.snapshot.event_version, event_type: e.event_type, payload: e })))],
    );
  }
}

/**
 * Runs one write (mode 'IMPORT' with a plan, or 'REMOVE'). Returns { runId, counts }. The summary audit entry is part of
 * the same database transaction, with an id derived from the run id (idempotent delivery to the Logs service).
 */
export async function writeRun(dataSource, { mode, plan = null, options, operator, inputsDigest = null, backups }) {
  const runId = randomUUID();
  const now = new Date();
  const counts = await dataSource.transaction(async (manager) => {
    await manager.query("SET LOCAL lock_timeout = '15s'");
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', SEED_LOCK);
    const state = await reservedRangeState(manager);
    if (state.unowned) {
      throw new SeedWriteError(`${state.unowned} row(s) in the reserved 9001-9999 range are not owned by an import. Review them; nothing was changed.`, { unowned: state.unowned });
    }
    await manager.query(
      `INSERT INTO seed_runs (run_id, mode, algorithm_version, random_seed, period_from, period_to, as_of, operator_id, inputs_digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [runId, mode, ALGORITHM_VERSION, options.seed ?? null, options.from ?? null, options.to ?? null, options.asOf ?? null, operator.id, inputsDigest],
    );
    const removal = await removeOwned(manager, runId);
    const result = { mode, removed: removal.removed, removed_outbox_events: removal.outbox, inserted_completed: 0, inserted_open: 0, late: 0 };
    if (mode === 'IMPORT') {
      const rows = [...plan.completed, ...plan.open];
      const tracking = rows.map((r) => r.tracking_no);
      if (!tracking.every(isSeededTrackingNo)) throw new SeedWriteError('A planned tracking number is outside the reserved range');
      const taken = await manager.query('SELECT count(*)::int AS n FROM transactions WHERE tracking_no = ANY($1::text[])', [tracking]);
      if (taken[0].n) throw new SeedWriteError(`${taken[0].n} planned tracking number(s) are already used. Nothing was changed.`);
      const records = rows.map((row) => toRecord(row, runId));
      try {
        await insertRows(manager, records);
      } catch (err) {
        if (err?.constraint === 'transactions_one_open_per_staff_uq' || /one_open_per_staff/.test(err?.message ?? '')) {
          throw new SeedWriteError('A staff account started a live transaction since the plan was made (one open per staff). Run the dry run again.');
        }
        throw err;
      }
      await manager.query(
        `INSERT INTO seeded_transactions (transaction_id, run_id, tracking_no)
         SELECT x.transaction_id, $2, x.tracking_no FROM jsonb_to_recordset($1::jsonb) AS x(transaction_id uuid, tracking_no varchar(60))`,
        [JSON.stringify(records.map((r) => ({ transaction_id: r.transaction_id, tracking_no: r.tracking_no }))), runId],
      );
      await publishAnalytics(manager, records.map((r) => r.transaction_id), now);
      Object.assign(result, {
        inserted_completed: plan.completed.length,
        inserted_open: plan.open.length,
        late: plan.completed.filter((r) => r.is_compliant === false).length,
        plan_digest: plan.digest,
      });
    }
    await manager.query('UPDATE seed_runs SET counts = $2::jsonb WHERE run_id = $1', [runId, JSON.stringify(result)]);
    await recordAudit(manager, {
      auditId: uuidFromName(`seed-audit|${runId}`),
      actor: operator,
      action: mode === 'IMPORT' ? 'HISTORICAL_RECORDS_IMPORTED' : 'HISTORICAL_RECORDS_REMOVED',
      entityType: 'historical_import',
      entityId: runId,
      // Counts, period, seed, version and backup references only: no names, numbers, emails or account lists.
      after: {
        run_id: runId, mode, period_from: options.from ?? null, period_to: options.to ?? null, as_of: options.asOf ?? null,
        random_seed: options.seed ?? null, algorithm_version: ALGORITHM_VERSION, inputs_digest: inputsDigest, ...result,
        backups: { operations: backups.operations, oversight: backups.oversight },
      },
      occurredAt: now,
    });
    return result;
  });
  return { runId, counts };
}

/**
 * Removes the Oversight projection rows of every removed seeded transaction not yet purged (any earlier run included), in
 * batches of 500, through Oversight's seeded-only purge command. Safe to repeat. Returns { purged, tombstoned, pending }.
 */
export async function purgeOversight(dataSource, { oversightUrl, serviceKey, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const base = serviceApiBase(oversightUrl);
  let purged = 0;
  let tombstoned = 0;
  for (;;) {
    const batch = await dataSource.query(
      `SELECT transaction_id, tracking_no FROM seeded_transactions
        WHERE removed_at IS NOT NULL AND oversight_purged_at IS NULL ORDER BY transaction_id LIMIT 500`,
    );
    if (!batch.length) break;
    let response;
    try {
      response = await fetchImpl(`${base}/internal/analytics-purge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-key': serviceKey ?? '', 'x-correlation-id': randomUUID() },
        body: JSON.stringify({ items: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SeedWriteError('Oversight could not be reached for the analytics purge');
    }
    if (!response.ok) throw new SeedWriteError(`Oversight answered ${response.status} to the analytics purge`);
    const body = await response.json();
    purged += body.purged ?? 0;
    tombstoned += body.tombstoned ?? 0;
    await dataSource.query('UPDATE seeded_transactions SET oversight_purged_at = now() WHERE transaction_id = ANY($1::uuid[])', [batch.map((r) => r.transaction_id)]);
  }
  const [{ n }] = await dataSource.query('SELECT count(*)::int AS n FROM seeded_transactions WHERE removed_at IS NOT NULL AND oversight_purged_at IS NULL');
  return { purged, tombstoned, pending: n };
}

/** Reads the owned rows back and computes the same business digest as the plan (read only). */
export async function storedDigest(queryable) {
  const rows = await queryable.query(
    `SELECT t.* FROM transactions t JOIN seeded_transactions s ON s.transaction_id = t.transaction_id AND s.removed_at IS NULL`,
  );
  return { rows: rows.length, digest: planDigest(rows), sample: rows.length ? sha256(JSON.stringify(businessRecord(rows[0]))).slice(0, 8) : null };
}
