/** Resolve only names already permitted by the report DTO; preserve stored outage fallbacks. */
export async function withCurrentPublisherNames(rows, { env = process.env, fetchImpl = fetch } = {}) {
  const base = String(env.IDENTITY_URL ?? '').trim().replace(/\/+$/, '');
  if (!base || !env.SERVICE_KEY) return rows;
  const names = new Map();
  const ids = [...new Set(rows.filter((r) => Object.hasOwn(r, 'published_by_name')).map((r) => r.published_by).filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 8) {
    await Promise.all(ids.slice(offset, offset + 8).map(async (id) => {
      try {
        const api = base.endsWith('/api') ? base : `${base}/api`;
        const response = await fetchImpl(`${api}/internal/accounts/${encodeURIComponent(id)}`, {
          headers: { accept: 'application/json', 'x-service-key': env.SERVICE_KEY }, signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return;
        const { full_name: name } = await response.json();
        if (typeof name === 'string' && name.trim() && name.trim().length <= 200) names.set(id, name.trim());
      } catch { /* Stored copy remains available during Identity outages. */ }
    }));
  }
  return rows.map((r) => Object.hasOwn(r, 'published_by_name') && names.has(r.published_by)
    ? { ...r, published_by_name: names.get(r.published_by) } : r);
}
