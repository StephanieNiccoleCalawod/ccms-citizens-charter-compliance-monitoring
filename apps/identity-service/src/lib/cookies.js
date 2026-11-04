import { config } from './config.js';

export const REFRESH_COOKIE = 'ccms_refresh';

// The refresh token lives in an httpOnly cookie scoped to the auth API path, so page scripts
// cannot read it. The access token is returned in the response body and kept in memory only.
export function refreshCookie(token) {
  const parts = [
    `${REFRESH_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=${config.publicApiBase}/auth`,
    `Max-Age=${config.refreshTokenDays * 86_400}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedRefreshCookie() {
  const parts = [`${REFRESH_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', `Path=${config.publicApiBase}/auth`, 'Max-Age=0'];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

/** Reads the refresh token from the cookie (browsers) or a JSON body field (API clients). */
export async function readRefreshToken(request) {
  const cookies = request.headers.get('cookie') ?? '';
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (match) return decodeURIComponent(match.slice(REFRESH_COOKIE.length + 1));
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await request.json().catch(() => null);
    if (typeof body?.refresh_token === 'string') return body.refresh_token;
  }
  return null;
}
