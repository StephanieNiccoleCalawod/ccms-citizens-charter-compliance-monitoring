import {
  ANALYTICS_MAX_BATCH,
  ANALYTICS_SCHEMA_VERSION,
  ANALYTICS_SOURCE_COLUMNS,
  Errors,
  decodeAnalyticsCursor,
  encodeAnalyticsCursor,
  snapshotFromTransactionRow,
} from 'ccms-shared';

// TT2 export for the Oversight backfill: GET /api/transactions/analytics-export?limit=&cursor= (service key only).
//
// Every transaction, whatever its status (open, held, pending result, completed, cancelled, auto-closed, seeded), in
// keyset order of transaction_id, which never changes. Each page is one read (READ COMMITTED). Consistency:
//   - a row is exported with its current analytics_event_version and the same columns the live producer reads, so the
//     export of version N equals the live snapshot of version N;
//   - a row updated after its page was read is also in the live outbox with a higher version, which wins in Oversight;
//   - a row inserted behind the cursor during a pass is missed by that pass, but its insert wrote a STARTED event in
//     the same database transaction, so the live feed delivers it. Every row present when a pass starts is visited.
// Termination: next_cursor is null on the last page (fewer rows than the limit remain). Nothing is recalculated and no
// other system is asked; the source rows are only read.

export const EXPORT_DEFAULT_LIMIT = ANALYTICS_MAX_BATCH;

export function parseExportQuery(searchParams) {
  const rawLimit = searchParams.get('limit');
  let limit = EXPORT_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d{1,4}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > ANALYTICS_MAX_BATCH) {
      throw Errors.validation('Please correct the highlighted fields', { limit: `limit must be a whole number from 1 to ${ANALYTICS_MAX_BATCH}` });
    }
    limit = Number(rawLimit);
  }
  const rawCursor = searchParams.get('cursor');
  const after = rawCursor === null || rawCursor === '' ? null : decodeAnalyticsCursor(rawCursor);
  for (const key of searchParams.keys()) {
    if (!['limit', 'cursor'].includes(key)) throw Errors.validation('Please correct the highlighted fields', { [key]: 'Unknown parameter' });
  }
  return { limit, after };
}

/** One export page: { schema_version, items, next_cursor }. */
export async function exportAnalyticsPage(dataSource, { limit = EXPORT_DEFAULT_LIMIT, after = null } = {}) {
  const columns = ANALYTICS_SOURCE_COLUMNS.join(', ');
  const rows = await dataSource.query(
    `SELECT ${columns} FROM transactions
      WHERE ($1::uuid IS NULL OR transaction_id > $1::uuid)
      ORDER BY transaction_id ASC
      LIMIT $2`,
    [after, limit + 1],
  );
  const page = rows.slice(0, limit);
  const items = page.map((row) => snapshotFromTransactionRow(row));
  const nextCursor = rows.length > limit ? encodeAnalyticsCursor(page[page.length - 1].transaction_id) : null;
  return { schema_version: ANALYTICS_SCHEMA_VERSION, items, next_cursor: nextCursor };
}
