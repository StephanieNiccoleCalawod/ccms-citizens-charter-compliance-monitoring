import { isSeededTrackingNo, latestSnapshotPerTransaction } from 'ccms-shared';
import { SEED_PURGE_LOCK } from '../../../migrations/1794528400000-Tt1AnalyticsTombstones.js';

// TT2: the one write path into analytics_transactions, used by the live ingest (POST /api/analytics-events) and by the
// backfill. Input snapshots are already validated by the shared contract.
//
// Rules:
//  - per transaction_id, only the highest event_version is kept. A batch is first reduced to its highest version per
//    transaction (so one statement never touches a row twice), then upserted with
//      ON CONFLICT (transaction_id) DO UPDATE SET <every field> = EXCLUDED.<field>
//      WHERE EXCLUDED.event_version > analytics_transactions.event_version
//    An equal or lower version changes nothing at all (received_at included). A higher version replaces the whole
//    snapshot, legitimate nulls included (no COALESCE).
//  - is_seeded is derived here from the tracking number (K16); nothing in the input can set it.
//  - rows are written in transaction_id order, so concurrent batches take row locks in the same order.

const COLUMNS = [
  ['transaction_id', 'uuid'],
  ['tracking_no', 'varchar(60)'],
  ['office_id', 'uuid'],
  ['service_id', 'uuid'],
  ['service_code', 'varchar(200)'],
  ['classification', 'varchar(20)'],
  ['client_type', 'varchar(20)'],
  ['standard_days', 'integer'],
  ['standard_hours', 'integer'],
  ['standard_minutes', 'integer'],
  ['started_at', 'timestamptz'],
  ['ended_at', 'timestamptz'],
  ['status', 'varchar(20)'],
  ['elapsed_working_minutes', 'integer'],
  ['is_compliant', 'boolean'],
  ['variance_minutes', 'integer'],
  ['held_minutes', 'integer'],
  ['is_backdated', 'boolean'],
  ['started_outside_hours', 'boolean'],
  ['registry_status', 'varchar(12)'],
  ['registry_miss_reason', 'varchar(20)'],
  ['outcome', 'varchar(12)'],
  ['started_by_user_id', 'uuid'],
  ['ended_by_user_id', 'uuid'],
  ['counter_id', 'uuid'],
  ['event_version', 'integer'],
  ['queue_wait_minutes', 'integer'], // CC040: optional in the contract; absent in older snapshots = null
  ['is_seeded', 'boolean'],
];
const NAMES = COLUMNS.map(([name]) => name);
const UPDATABLE = NAMES.filter((name) => name !== 'transaction_id');

const UPSERT_SQL = `
  INSERT INTO analytics_transactions (${NAMES.join(', ')}, received_at)
  SELECT ${NAMES.map((n) => `x.${n}`).join(', ')}, now()
    FROM jsonb_to_recordset($1::jsonb) AS x(${COLUMNS.map(([n, t]) => `${n} ${t}`).join(', ')})
   -- Sprint 6 TT1: a removed seeded row is never restored by a late or replayed event or a backfill page.
   WHERE NOT EXISTS (SELECT 1 FROM analytics_tombstones t WHERE t.transaction_id = x.transaction_id)
   ORDER BY x.transaction_id
  ON CONFLICT (transaction_id) DO UPDATE
     SET ${UPDATABLE.map((n) => `${n} = EXCLUDED.${n}`).join(', ')}, received_at = now()
   WHERE EXCLUDED.event_version > analytics_transactions.event_version
  RETURNING transaction_id`;

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

/**
 * Applies validated snapshots with `manager` (a DataSource or an open transaction's manager): one upsert, atomic.
 * Returns { applied, ignored } where ignored counts snapshots that were not stored (same or older version than the
 * stored row, a lower version of a transaction that appears again in the same batch, or a tombstoned seeded row).
 *
 * Sprint 6 TT1: a batch containing a seeded row first takes SEED_PURGE_LOCK in shared mode, inside a database
 * transaction, so it never overlaps purge_seeded_analytics() (exclusive). The upsert, and its tombstone check, then run in
 * a later statement whose snapshot includes any purge that committed while this batch waited.
 */
export async function applyAnalyticsSnapshots(manager, snapshots) {
  if (!snapshots.length) return { applied: 0, ignored: 0 };
  const { latest, superseded } = latestSnapshotPerTransaction(snapshots);
  const records = latest.map((snapshot) => ({ ...pick(snapshot), is_seeded: isSeededTrackingNo(snapshot.tracking_no) }));
  const write = async (m) => {
    if (records.some((r) => r.is_seeded)) await m.query('SELECT pg_advisory_xact_lock_shared($1, $2)', SEED_PURGE_LOCK);
    return rowsOf(await m.query(UPSERT_SQL, [JSON.stringify(records)]));
  };
  // A transaction-scoped lock needs a transaction: open one when the caller did not.
  const written = manager.queryRunner?.isTransactionActive ? await write(manager) : await manager.transaction(write);
  return { applied: written.length, ignored: superseded + (latest.length - written.length) };
}

// Field-by-field copy of the contract fields (never a spread of the input).
function pick(snapshot) {
  const out = {};
  for (const name of NAMES) if (name !== 'is_seeded') out[name] = snapshot[name];
  return out;
}

/** Validated live events (ingest): written in one database transaction. */
export async function ingestAnalyticsEvents(dataSource, events) {
  const snapshots = events.map((event) => event.snapshot);
  const result = await dataSource.transaction((manager) => applyAnalyticsSnapshots(manager, snapshots));
  return { accepted: events.length, ...result };
}
