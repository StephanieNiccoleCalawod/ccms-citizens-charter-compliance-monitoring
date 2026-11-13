import { bearerToken, createDbStore, createRateLimiter, json, route } from 'ccms-shared';
import { exchangeClerkSession } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled, verifyClerkToken } from '../../../../../lib/clerk.js';
import { getDb } from '../../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// Per Clerk user (not per address: a whole campus can share one address). The browser exchanges about once per access
// token lifetime, so this only stops a loop or abuse.
const EXCHANGE_LIMITS = { limit: 30, windowMs: 5 * 60_000 };
const defaultLimiter = createRateLimiter({ store: createDbStore(getDb) });
let limiter = defaultLimiter;

/** Tests replace the limiter; pass null to restore the database-backed one. */
export function setExchangeLimiter(value) {
  limiter = value ?? defaultLimiter;
}

// POST /auth/clerk/exchange  (Authorization: Bearer <Clerk session token>)
// -> 200 { access_token, token_type, expires_in, user } for a person bound to an active CCMS account. No refresh cookie.
// -> 403 CCMS_ACCESS_PENDING ("No access yet"; recorded for the Super Admin) | 403 ACCOUNT_INACTIVE
// -> 401 INVALID_CLERK_TOKEN | 404 while Clerk sign-in is switched off (CLERK_AUTH_ENABLED).
export const POST = route(async (request, { correlationId }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const identity = await verifyClerkToken(bearerToken(request), settings);

  const result = await limiter.check(`clerk-exchange:${identity.subject}`, EXCHANGE_LIMITS);
  if (!result.allowed) {
    return json(
      { error: { code: 'RATE_LIMITED', message: `Too many sign-in attempts. Try again in ${result.retryAfterSeconds} seconds.`, details: null, correlation_id: correlationId } },
      429,
      { 'retry-after': String(result.retryAfterSeconds), 'cache-control': 'no-store' },
    );
  }

  const session = await exchangeClerkSession(await getDb(), identity);
  return json({ access_token: session.accessToken, token_type: 'Bearer', expires_in: session.expiresIn, user: session.user }, 200, {
    'cache-control': 'no-store',
  });
});
