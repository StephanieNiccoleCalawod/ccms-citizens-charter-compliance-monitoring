/**
 * Operations asks Identity for one thing: a staff member's position (CC046). Service key, a short timeout, no retry.
 * Every failure (not configured, down, slow, unknown account, unreadable answer) gives null, because the position is a
 * label and must never block a Start.
 */
export function identityBaseUrl(env = process.env) {
  const raw = String(env.IDENTITY_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

export function createIdentityClient({ baseUrl = identityBaseUrl(), serviceKey = process.env.SERVICE_KEY, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  return {
    async positionOf(accountId) {
      if (!baseUrl || !accountId) return null;
      try {
        const response = await fetchImpl(`${baseUrl}/internal/accounts/${encodeURIComponent(accountId)}`, {
          headers: { accept: 'application/json', 'x-service-key': serviceKey ?? '' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const position = typeof payload?.position === 'string' ? payload.position.trim() : '';
        return position && position.length <= 100 ? position : null;
      } catch {
        return null;
      }
    },
  };
}
