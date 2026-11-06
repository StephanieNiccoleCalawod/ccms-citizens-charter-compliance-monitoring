import { noContent, route } from 'ccms-shared';
import { logout } from '../../../../lib/auth-service.js';
import { clearedRefreshCookie, readRefreshToken } from '../../../../lib/cookies.js';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// POST /auth/logout -> revokes the refresh token and clears the cookie.
export const POST = route(async (request) => {
  await logout(await getDb(), await readRefreshToken(request));
  return noContent({ 'set-cookie': clearedRefreshCookie(), 'cache-control': 'no-store' });
});
