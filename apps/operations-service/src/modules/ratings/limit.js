import { buildErrorBody, clientIp, createDbStore, createRateLimiter } from 'ccms-shared';
import { getDb } from '../../lib/data-source.js';

// CC057: the public rating endpoint is limited per client address before the code is looked at (so codes cannot be guessed in bulk).
// TEAM DEFAULT: 20 attempts per client address per 10 minutes; override with RATING_RATE_LIMIT and RATING_RATE_WINDOW_SECONDS.
let limiter = null;
const current = () => (limiter ??= createRateLimiter({ store: createDbStore(getDb) }));
export const setRatingLimiter = (value) => { limiter = value ?? null; };
export function ratingRateLimits(env = process.env) {
  const limit = Number(env.RATING_RATE_LIMIT);
  const seconds = Number(env.RATING_RATE_WINDOW_SECONDS);
  return { limit: Number.isInteger(limit) && limit > 0 ? limit : 20, windowMs: (Number.isInteger(seconds) && seconds > 0 ? seconds : 600) * 1000 };
}
export async function limitRatingRequest(request, correlationId, env = process.env) {
  const result = await current().check(`rating:${clientIp(request) ?? 'unknown'}`, ratingRateLimits(env));
  if (result.allowed) return null;
  return new Response(JSON.stringify(buildErrorBody({ code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.', correlationId })), {
    status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(result.retryAfterSeconds), 'cache-control': 'no-store' },
  });
}
