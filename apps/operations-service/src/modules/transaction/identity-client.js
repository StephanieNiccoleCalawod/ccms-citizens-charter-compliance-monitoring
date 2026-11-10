/**
 * Operations asks Identity for two labels about the person who starts a transaction (CC046): their position and their display
 * name. Service key, a short timeout, no retry. Every failure (not configured, down, slow, unknown account, unreadable
 * answer) gives nothing, because these are labels and must never block a Start.
 */
const clean = (value, max) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
};

export function identityBaseUrl(env = process.env) {
  const raw = String(env.IDENTITY_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

export function createIdentityClient({ baseUrl = identityBaseUrl(), serviceKey = process.env.SERVICE_KEY, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  async function starterOf(accountId) {
    const none = { name: null, position: null };
    if (!baseUrl || !accountId) return none;
    try {
      const response = await fetchImpl(`${baseUrl}/internal/accounts/${encodeURIComponent(accountId)}`, {
        headers: { accept: 'application/json', 'x-service-key': serviceKey ?? '' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return none;
      const payload = await response.json();
      return { name: clean(payload?.full_name, 200), position: clean(payload?.position, 100) };
    } catch {
      return none;
    }
  }
  return {
    /** { name, position }: each is a trimmed text or null. Never throws. */
    starterOf,
    async positionOf(accountId) {
      return (await starterOf(accountId)).position;
    },
  };
}
