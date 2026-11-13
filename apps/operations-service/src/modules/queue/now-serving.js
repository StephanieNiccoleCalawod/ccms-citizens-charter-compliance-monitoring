import { Errors, buildErrorBody, clientIp, createDbStore, createRateLimiter, isUuid } from 'ccms-shared';
import { getDb } from '../../lib/data-source.js';
import { readNowServing } from './tickets.js';

// CC059 (spec 8.5, K7): the public, read-only "Now serving" screen for a waiting-area TV. The page asks every 5 seconds, so the
// limit is per client address and generous: TEAM DEFAULT 90 requests a minute (override NOW_SERVING_RATE_LIMIT /
// NOW_SERVING_RATE_WINDOW_SECONDS). It answers display numbers only (readNowServing): no ids, lanes, times or anything about a person.
let limiter = null;
const current = () => (limiter ??= createRateLimiter({ store: createDbStore(getDb) }));
export const setNowServingLimiter = (value) => { limiter = value ?? null; };

export function nowServingRateLimits(env = process.env) {
  const limit = Number(env.NOW_SERVING_RATE_LIMIT);
  const seconds = Number(env.NOW_SERVING_RATE_WINDOW_SECONDS);
  return { limit: Number.isInteger(limit) && limit > 0 ? limit : 90, windowMs: (Number.isInteger(seconds) && seconds > 0 ? seconds : 60) * 1000 };
}

export async function limitNowServingRequest(request, correlationId, env = process.env) {
  const result = await current().check(`queue:now-serving:${clientIp(request) ?? 'unknown'}`, nowServingRateLimits(env));
  if (result.allowed) return null;
  return new Response(JSON.stringify(buildErrorBody({ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.', correlationId })), {
    status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(result.retryAfterSeconds), 'cache-control': 'no-store' },
  });
}

/** GET /queue/public/now-serving?office_id= : { queue_date, current, next[3] }. An office with no tickets today answers empty, not an error. */
export async function publicNowServing(db, params, { now = new Date() } = {}) {
  const officeId = params.get('office_id');
  if (!isUuid(officeId)) throw Errors.validation('Choose an office.', { office_id: 'office_id must be a valid UUID' });
  return readNowServing(db, officeId.toLowerCase(), { now });
}
