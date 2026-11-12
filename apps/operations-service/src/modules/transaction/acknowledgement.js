import { randomUUID } from 'node:crypto';
import { recordAudit } from 'ccms-shared';
import { kickOutbox } from '../../lib/outbox.js';
import { SAFE_RETRY_WINDOW_MS, TransportError } from '../../lib/idempotent-mail.js';
import { SYSTEM_ACTOR } from './constants.js';
import { rowsOf } from './db.js';
import { manilaStamp } from './receipt.js';

// CC049 (spec 6.3, K25, J10): the acknowledgement at Start, as an email of kind ACKNOWLEDGEMENT.
//
// State per (transaction, kind) in transaction_emails, independent of the completion receipt:
//   PENDING -> SENDING (claimed with a token and a lease) -> SENT (terminal)
//                                                          -> FAILED, retried with backoff while attempts < 5 and the first
//                                                             attempt is inside the safe idempotency window
//                                                          -> FAILED terminal (next_attempt_at = infinity): attempts used up,
//                                                             the provider refused, or the window passed (DEDUPE_WINDOW_EXPIRED)
// Every attempt of a row, by any worker, uses the same idempotency key and a byte-identical payload, so a crash after the
// provider accepted the message is recovered by re-sending with the key: the provider answers with the original result
// and sends nothing more (see src/lib/idempotent-mail.js). SMTP is never used for this kind.
//
// Seeded history never gets a row here (the import has its own path), and existing transactions are never backfilled.

export const ACK_KIND = 'ACKNOWLEDGEMENT';
export const ACK_MAX_ATTEMPTS = 5;
export const ACK_BATCH = 50;
export const ACK_LEASE_MS = 120_000;
export const ACK_QUOTE_LINE = 'Quote this tracking number for any follow-up or complaint';

/** Stable for the row's whole life: one key per transaction and kind. */
export const acknowledgementKey = (transactionId) => `ccms-ack-${transactionId}`;

/** Queues the acknowledgement inside the Start's own database transaction. Only call it when the final email exists. */
export async function queueAcknowledgement(manager, transactionId) {
  await manager.query(
    `INSERT INTO transaction_emails (email_id, transaction_id, kind, status, idempotency_key)
     VALUES ($1, $2, $3, 'PENDING', $4)
     ON CONFLICT (transaction_id, kind) DO NOTHING`,
    [randomUUID(), transactionId, ACK_KIND, acknowledgementKey(transactionId)],
  );
}

/**
 * The acknowledgement email, built only from values saved at Start (never re-read from Identity or Core), so every retry
 * sends exactly the same payload. RA 11032 Sec. 9(a): the unique number, the unit, the officer's name and designation, and
 * the date and time of receipt. The officer's saved name and position may appear here (J10); the receipt keeps its
 * no-staff-names rule.
 */
export function buildAcknowledgement(row) {
  const officer = row.started_by_name ?? 'Not recorded';
  const position = row.started_by_position ?? 'Not recorded';
  return {
    to: row.client_email,
    subject: `Acknowledgement of your request ${row.tracking_no}`,
    text: [
      'Polytechnic University of the Philippines',
      'Acknowledgement of receipt',
      '',
      `Tracking number: ${row.tracking_no}`,
      `Office: ${row.office_name ?? row.office_code}`,
      `Service: ${row.service_name}`,
      `Received by: ${officer}`,
      `Position: ${position}`,
      `Date and time received: ${manilaStamp(row.started_at)} (Philippine time)`,
      '',
      `${ACK_QUOTE_LINE}.`,
    ].join('\n'),
  };
}

const backoffSeconds = (attempts) => Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);

async function audit(dataSource, row, sent) {
  await recordAudit(dataSource.manager, {
    ...SYSTEM_ACTOR,
    action: sent ? 'ACKNOWLEDGEMENT_EMAIL_SENT' : 'ACKNOWLEDGEMENT_EMAIL_FAILED',
    entityType: 'transaction',
    entityId: row.transaction_id,
    entityName: row.tracking_no,
    officeId: row.office_id,
    // No address, no officer details, no provider body.
    after: { tracking_no: row.tracking_no, kind: ACK_KIND },
  });
}

/** Ends rows that can no longer be retried safely: expired leases past the window or with every attempt used. */
async function closeExpired(dataSource, windowMs) {
  const closed = rowsOf(await dataSource.query(
    `UPDATE transaction_emails e
        SET status = 'FAILED', claim_token = NULL, claim_until = NULL, next_attempt_at = 'infinity',
            last_error_code = CASE WHEN e.attempts >= $1 THEN 'ATTEMPTS_EXHAUSTED' ELSE 'DEDUPE_WINDOW_EXPIRED' END,
            updated_at = clock_timestamp()
      WHERE e.kind = $2
        AND ((e.status = 'SENDING' AND e.claim_until <= clock_timestamp()) OR (e.status IN ('PENDING', 'FAILED') AND e.next_attempt_at <> 'infinity'))
        AND (e.attempts >= $1 OR (e.first_attempt_at IS NOT NULL AND e.first_attempt_at <= clock_timestamp() - $3 * interval '1 millisecond'))
      RETURNING e.transaction_id`,
    [ACK_MAX_ATTEMPTS, ACK_KIND, windowMs],
  ));
  for (const { transaction_id: id } of closed) {
    const [row] = await dataSource.query('SELECT transaction_id, tracking_no, office_id FROM transactions WHERE transaction_id = $1', [id]);
    if (row) await audit(dataSource, row, false);
  }
  return closed.length;
}

/**
 * One attempt for one queued row. Returns 'sent' | 'retry' | 'failed' | 'skipped'.
 * The claim commits before the network call; the outcome is recorded only while this worker still holds the token.
 */
export async function sendAcknowledgement(dataSource, transport, emailId, { leaseMs = ACK_LEASE_MS, windowMs = SAFE_RETRY_WINDOW_MS } = {}) {
  const token = randomUUID();
  const [claimed] = rowsOf(await dataSource.query(
    `UPDATE transaction_emails
        SET status = 'SENDING', attempts = attempts + 1, claim_token = $2,
            claim_until = clock_timestamp() + $3 * interval '1 millisecond',
            first_attempt_at = COALESCE(first_attempt_at, clock_timestamp()), updated_at = clock_timestamp()
      WHERE email_id = $1 AND kind = $4 AND attempts < $5
        AND (first_attempt_at IS NULL OR first_attempt_at > clock_timestamp() - $6 * interval '1 millisecond')
        AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= clock_timestamp())
          OR (status = 'SENDING' AND claim_until <= clock_timestamp()))
      RETURNING email_id, transaction_id, attempts, idempotency_key`,
    [emailId, token, leaseMs, ACK_KIND, ACK_MAX_ATTEMPTS, windowMs],
  ));
  if (!claimed) return 'skipped';
  const [row] = await dataSource.query(
    `SELECT transaction_id, tracking_no, office_id, office_code, office_name, service_name, started_at, started_by_name,
            started_by_position, client_email
       FROM transactions WHERE transaction_id = $1`,
    [claimed.transaction_id],
  );

  let outcome;
  let providerMessageId = null;
  let errorCode = null;
  if (!row?.client_email) {
    outcome = 'failed';
    errorCode = 'NO_ADDRESS';
  } else {
    try {
      ({ providerMessageId } = await transport.send({ ...buildAcknowledgement(row), idempotencyKey: claimed.idempotency_key }));
      outcome = 'sent';
    } catch (err) {
      errorCode = err instanceof TransportError ? err.code : 'UNEXPECTED';
      const retryable = err instanceof TransportError ? err.retryable : true;
      outcome = retryable && claimed.attempts < ACK_MAX_ATTEMPTS ? 'retry' : 'failed';
    }
  }

  let updated;
  if (outcome === 'sent') {
    updated = rowsOf(await dataSource.query(
      `UPDATE transaction_emails SET status = 'SENT', sent_at = clock_timestamp(), provider_message_id = $3, last_error_code = NULL,
              claim_token = NULL, claim_until = NULL, updated_at = clock_timestamp()
        WHERE email_id = $1 AND status = 'SENDING' AND claim_token = $2 RETURNING email_id`,
      [emailId, token, providerMessageId],
    ));
  } else {
    updated = rowsOf(await dataSource.query(
      `UPDATE transaction_emails SET status = 'FAILED', last_error_code = $3, claim_token = NULL, claim_until = NULL,
              next_attempt_at = CASE WHEN $4 THEN clock_timestamp() + $5 * interval '1 second' ELSE 'infinity'::timestamptz END,
              updated_at = clock_timestamp()
        WHERE email_id = $1 AND status = 'SENDING' AND claim_token = $2 RETURNING email_id`,
      [emailId, token, errorCode, outcome === 'retry', backoffSeconds(claimed.attempts)],
    ));
  }
  // Another worker took over after this lease expired: it owns the outcome (and uses the same key).
  if (!updated[0]) return 'skipped';
  if (row && outcome !== 'retry') {
    await audit(dataSource, row, outcome === 'sent');
    kickOutbox();
  }
  return outcome;
}

/**
 * One run: closes rows that can no longer be retried safely, then tries up to 50 due rows, oldest first.
 * Without a configured idempotent transport nothing is attempted and no attempt is counted.
 */
export async function runAcknowledgementJob({ dataSource, transport, windowMs = SAFE_RETRY_WINDOW_MS }) {
  if (!transport.configured) return { skipped: true, reason: transport.reason ?? 'not configured', checked: 0, sent: 0, retried: 0, failed: 0 };
  const closed = await closeExpired(dataSource, windowMs);
  const due = await dataSource.query(
    `SELECT email_id FROM transaction_emails
      WHERE kind = $1 AND attempts < $2
        AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= clock_timestamp())
          OR (status = 'SENDING' AND claim_until <= clock_timestamp()))
      ORDER BY created_at ASC, email_id ASC LIMIT ${ACK_BATCH}`,
    [ACK_KIND, ACK_MAX_ATTEMPTS],
  );
  const counts = { skipped: false, checked: due.length, sent: 0, retried: 0, failed: closed };
  for (const { email_id: id } of due) {
    const result = await sendAcknowledgement(dataSource, transport, id, { windowMs });
    if (result === 'sent') counts.sent += 1;
    else if (result === 'retry') counts.retried += 1;
    else if (result === 'failed') counts.failed += 1;
  }
  return counts;
}
