import { buildErrorBody, clientIp, createDbStore, createRateLimiter } from 'ccms-shared';
import { getDb } from '../../lib/data-source.js';

// CC039: the public "Take a ticket" endpoint is limited per client address BEFORE any number is allocated, with the shared
// ccms-shared fixed-window limiter on this service's own rate_limit_hits table (so it holds across serverless instances).
// The client address is clientIp(): the first X-Forwarded-For entry, which the gateway forwards unchanged from the platform
// in front of it (the same convention as the public catalogue and complaints).
//
// TEAM DEFAULT: 10 tickets per client address per 10 minutes. Override with QUEUE_TICKET_RATE_LIMIT (requests) and
// QUEUE_TICKET_RATE_WINDOW_SECONDS. A shared kiosk or campus NAT puts many people behind one address: raise the limit there
// rather than switching it off.
export const QUEUE_RATE_DEFAULTS = Object.freeze({ limit: 10, windowSeconds: 600 });
export const RATE_LIMITED = 'Too many tickets were requested from this device. Please wait a moment and try again.';

let limiter = null;
const current = () => (limiter ??= createRateLimiter({ store: createDbStore(getDb) }));
/** Tests replace the limiter (null restores the database-backed one). */
export const setQueueLimiter = (value) => { limiter = value ?? null; };

export function queueRateLimits(env = process.env) {
  const limit = Number(env.QUEUE_TICKET_RATE_LIMIT);
  const windowSeconds = Number(env.QUEUE_TICKET_RATE_WINDOW_SECONDS);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : QUEUE_RATE_DEFAULTS.limit,
    windowMs: (Number.isInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : QUEUE_RATE_DEFAULTS.windowSeconds) * 1000,
  };
}

/** null when allowed, else a ready 429 (Retry-After, no-store). Counts this request. */
export async function limitTicketRequest(request, correlationId, env = process.env) {
  const result = await current().check(`queue:issue:${clientIp(request) ?? 'unknown'}`, queueRateLimits(env));
  if (result.allowed) return null;
  return new Response(JSON.stringify(buildErrorBody({ code: 'RATE_LIMITED', message: RATE_LIMITED, correlationId })), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(result.retryAfterSeconds), 'cache-control': 'no-store' },
  });
}
