import { AppError, buildErrorBody, json, route } from 'ccms-shared';
import { refresh } from '../../../../lib/auth-service.js';
import { clearedRefreshCookie, readRefreshToken, refreshCookie } from '../../../../lib/cookies.js';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// POST /auth/refresh -> a new access token while the refresh token is valid, unrevoked and unexpired.
export const POST = route(async (request, { correlationId }) => {
  try {
    const session = await refresh(await getDb(), await readRefreshToken(request));
    return json({ access_token: session.accessToken, token_type: 'Bearer', expires_in: session.expiresIn, user: session.user }, 200, {
      'set-cookie': refreshCookie(session.refreshToken),
      'cache-control': 'no-store',
    });
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 401) throw err;
    // Expired or revoked: clear the cookie so the browser stops sending it.
    return json(buildErrorBody({ code: err.code, message: err.message, correlationId }), 401, {
      'set-cookie': clearedRefreshCookie(),
      'cache-control': 'no-store',
    });
  }
});
