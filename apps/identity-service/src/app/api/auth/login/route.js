import { AppError, Errors, buildErrorBody, clientIp, createDbStore, createRateLimiter, json, readJson, route } from 'ccms-shared';
import { login } from '../../../../lib/auth-service.js';
import { refreshCookie } from '../../../../lib/cookies.js';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

const LOGIN_LIMITS = { limit: 5, windowMs: 15 * 60_000 };
const SIGN_IN_UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again.';
const defaultLimiter = createRateLimiter({ store: createDbStore(getDb), failOpen: false });
let limiter = defaultLimiter;

/** Tests replace the shared limiter; pass null to restore the database-backed limiter. */
export function setLoginLimiter(value) {
  limiter = value ?? defaultLimiter;
}

const limiterKeys = (request, email) => [
  `login:email:${typeof email === 'string' ? email.trim().toLowerCase() : ''}`,
  `login:ip:${clientIp(request) ?? 'unknown'}`,
];

async function checkLimits(keys, consume) {
  try {
    return await Promise.all(keys.map((key) => limiter.check(key, { ...LOGIN_LIMITS, consume })));
  } catch {
    throw Errors.unavailable(SIGN_IN_UNAVAILABLE, 'SIGN_IN_UNAVAILABLE');
  }
}

function limitedResponse(results, correlationId) {
  const retryAfter = Math.max(...results.filter((result) => !result.allowed).map((result) => result.retryAfterSeconds));
  return json(
    buildErrorBody({ code: 'RATE_LIMITED', message: `Too many sign-in attempts. Try again in ${retryAfter} seconds.`, correlationId }),
    429,
    { 'retry-after': String(retryAfter), 'cache-control': 'no-store' },
  );
}

// POST /auth/login { email, password } -> access token (body) + refresh token (httpOnly cookie).
export const POST = route(async (request, { correlationId }) => {
  const credentials = await readJson(request);
  const keys = limiterKeys(request, credentials.email);
  const before = await checkLimits(keys, false);
  if (before.some((result) => !result.allowed)) return limitedResponse(before, correlationId);

  let session;
  try {
    session = await login(await getDb(), credentials);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 401 || err.code !== 'INVALID_CREDENTIALS') throw err;
    const after = await checkLimits(keys, true);
    if (after.some((result) => !result.allowed)) return limitedResponse(after, correlationId);
    throw err;
  }
  return json(
    { access_token: session.accessToken, token_type: 'Bearer', expires_in: session.expiresIn, user: session.user },
    200,
    { 'set-cookie': refreshCookie(session.refreshToken), 'cache-control': 'no-store' },
  );
});
