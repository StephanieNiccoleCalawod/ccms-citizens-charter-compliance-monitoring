import { randomUUID } from 'node:crypto';
import { ANALYTICS_SOURCE_COLUMNS, buildAnalyticsEvent, snapshotFromTransactionRow } from 'ccms-shared';
import { rowsOf } from '../transaction/db.js';

// TT2 producer: the ANALYTICS consumer of the Operations outbox (separate from recordAudit / audit_outbox).

const RETURNING = ANALYTICS_SOURCE_COLUMNS.join(', ');

/**
 * Emits one analytics snapshot for a transaction. Call it INSIDE the database transaction of the business change, after
 * the change: it increments transactions.analytics_event_version (under the row lock the business UPDATE already holds),
 * reads the authoritative row as it now stands, builds the snapshot field by field (ccms-shared contract) and writes
 * it to analytics_outbox. If the business transaction rolls back, so do the version and the event. No network call.
 * Returns { eventId, eventVersion }.
 */
export async function recordAnalytics(manager, transactionId, eventType, { occurredAt = new Date() } = {}) {
  const rows = rowsOf(
    await manager.query(
      `UPDATE transactions SET analytics_event_version = analytics_event_version + 1
        WHERE transaction_id = $1 RETURNING ${RETURNING}`,
      [transactionId],
    ),
  );
  if (!rows[0]) throw new Error('Analytics event for a transaction that does not exist');
  const event = buildAnalyticsEvent({ eventType, snapshot: snapshotFromTransactionRow(rows[0]), eventId: randomUUID(), occurredAt });
  await manager.query(
    `INSERT INTO analytics_outbox (event_id, transaction_id, event_version, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [event.event_id, event.snapshot.transaction_id, event.snapshot.event_version, event.event_type, JSON.stringify(event)],
  );
  return { eventId: event.event_id, eventVersion: event.snapshot.event_version };
}
