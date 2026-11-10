import { randomUUID } from 'node:crypto';
import { ANALYTICS_MAX_BATCH, serviceApiBase } from 'ccms-shared';
import { rowsOf as rowsOfQuery } from '../transaction/db.js';

// TT2 delivery of analytics_outbox to Oversight's POST /api/analytics-events (service key, never through the gateway).
//
//  claim     one UPDATE ... WHERE event_id IN (SELECT ... FOR UPDATE SKIP LOCKED) sets a fresh lease_token and
//            lease_until on at most `batchSize` undelivered, due, unleased (or lease-expired) rows, oldest first, and
//            counts the attempt. Two overlapping runs never hold the same row; a run that dies leaves a lease that expires.
//  send      one POST of { events: [...] } with a timeout.
//  ack       2xx with { accepted } equal to the number sent: delivered_at is set, only for rows that still carry THIS
//            run's lease_token (a run whose lease expired and was re-claimed cannot overwrite the newer claim).
//  failure   lease released, next_attempt_at pushed back (5 s doubling per attempt, at most 1 h), last_error = a short
//            status text only (never a response body or payload). A lost response is safe: the receiver ignores a
//            version it already has.
//  400       the receiver rejected the batch as a whole (it validates before writing). Retry a bounded number of single
//            events within the time budget; release the remainder for the next run. Due-time ordering lets deferred
//            events progress ahead of rejected events waiting for backoff.
// Audit delivery (audit_outbox, dispatchOutbox) shares nothing with this: separate table, lease, job and failure state.

const backoffSql = 'make_interval(secs => LEAST(5 * power(2, LEAST(GREATEST(attempts - 1, 0), 10)), 3600))';

async function claim(dataSource, { batchSize, leaseSeconds, token }) {
  return rowsOfQuery(
    await dataSource.query(
      `UPDATE analytics_outbox
          SET lease_token = $3, lease_until = now() + make_interval(secs => $2), attempts = attempts + 1
        WHERE event_id IN (
          SELECT event_id FROM analytics_outbox
           WHERE delivered_at IS NULL AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
           ORDER BY next_attempt_at ASC, created_at ASC, event_id ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
      RETURNING event_id, payload, created_at`,
      [batchSize, leaseSeconds, token],
    ),
  ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || (a.event_id < b.event_id ? -1 : 1));
}

async function markDelivered(dataSource, ids, token) {
  if (!ids.length) return 0;
  const rows = rowsOfQuery(
    await dataSource.query(
      `UPDATE analytics_outbox SET delivered_at = now(), lease_token = NULL, lease_until = NULL, last_error = NULL
        WHERE event_id = ANY($1::uuid[]) AND lease_token = $2 AND delivered_at IS NULL RETURNING event_id`,
      [ids, token],
    ),
  );
  return rows.length;
}

async function markFailed(dataSource, ids, token, message) {
  if (!ids.length) return;
  await dataSource.query(
    `UPDATE analytics_outbox
        SET lease_token = NULL, lease_until = NULL, last_error = $3, next_attempt_at = now() + ${backoffSql}
      WHERE event_id = ANY($1::uuid[]) AND lease_token = $2 AND delivered_at IS NULL`,
    [ids, token, String(message).slice(0, 500)],
  );
}

async function deferRemaining(dataSource, ids, token) {
  if (!ids.length) return;
  await dataSource.query(
    `UPDATE analytics_outbox
        SET lease_token = NULL, lease_until = NULL, last_error = 'Batch split pending', next_attempt_at = now()
      WHERE event_id = ANY($1::uuid[]) AND lease_token = $2 AND delivered_at IS NULL`,
    [ids, token],
  );
}

class DeliveryError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

async function send(events, { url, serviceKey, fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': serviceKey, 'x-correlation-id': randomUUID() },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new DeliveryError(timedOut ? 'Oversight did not answer in time' : 'Oversight could not be reached');
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new DeliveryError(`Oversight responded ${response.status}`, response.status);
  }
  let ack;
  try {
    ack = await response.json();
  } catch {
    throw new DeliveryError('Oversight sent an unreadable acknowledgement');
  }
  if (!ack || ack.accepted !== events.length) throw new DeliveryError('Oversight acknowledged a different number of events');
  return ack;
}

/**
 * Delivers one claimed batch. Returns { claimed, delivered, failed }. Never throws for a delivery problem.
 *   oversightUrl  Oversight's address with or without /api (LOGS_SERVICE_URL)
 */
export async function dispatchAnalyticsOutbox(
  dataSource,
  { oversightUrl, serviceKey, batchSize = ANALYTICS_MAX_BATCH, fetchImpl = fetch, timeoutMs = 10_000, leaseSeconds = 120,
    maxFallbackEvents = 10, timeBudgetMs = 20_000, clock = () => Date.now() } = {},
) {
  const started = clock();
  const base = serviceApiBase(oversightUrl);
  if (!base || !serviceKey) throw new Error('The Oversight address and SERVICE_KEY are required');
  const size = Math.min(Math.max(1, batchSize), ANALYTICS_MAX_BATCH);
  const token = randomUUID();
  const rows = await claim(dataSource, { batchSize: size, leaseSeconds, token });
  if (!rows.length) return { claimed: 0, delivered: 0, failed: 0 };
  const options = { url: `${base}/analytics-events`, serviceKey, fetchImpl, timeoutMs };

  let delivered = 0;
  let failed = 0;
  try {
    await send(rows.map((r) => r.payload), options);
    delivered += await markDelivered(dataSource, rows.map((r) => r.event_id), token);
  } catch (err) {
    if (err instanceof DeliveryError && err.status === 400 && rows.length > 1) {
      // One event at a time, so a single rejected event does not hold back the rest.
      for (const [index, row] of rows.entries()) {
        if (index >= maxFallbackEvents || clock() - started >= timeBudgetMs) {
          const deferred = rows.slice(index);
          await deferRemaining(dataSource, deferred.map((r) => r.event_id), token);
          failed += deferred.length;
          break;
        }
        try {
          await send([row.payload], options);
          delivered += await markDelivered(dataSource, [row.event_id], token);
        } catch (single) {
          await markFailed(dataSource, [row.event_id], token, single instanceof DeliveryError ? single.message : 'Delivery failed');
          failed += 1;
        }
      }
    } else {
      await markFailed(dataSource, rows.map((r) => r.event_id), token, err instanceof DeliveryError ? err.message : 'Delivery failed');
      failed += rows.length;
    }
  }
  return { claimed: rows.length, delivered, failed };
}
