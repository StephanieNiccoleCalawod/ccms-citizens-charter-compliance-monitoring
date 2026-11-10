/**
 * Working-day calendar lookup for the forecast service.
 * Calls Core's GET /is-working-day?date=YYYY-MM-DD&officeId= with the shared service key.
 * Results are cached per (officeId|'campus', date) for the lifetime of one job run to avoid N+1 queries.
 *
 * Uses the same call pattern as modules/transaction/core-client.js (service key, 5 s timeout, 1 retry)
 * but as a standalone client so as not to modify the existing module.
 */

import { randomUUID } from 'node:crypto';

export class CoreCalendarError extends Error {
  constructor(msg) { super(msg); this.name = 'CoreCalendarError'; }
}

function coreBase(env = process.env) {
  const raw = String(env.CORE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

async function fetchJson(url, serviceKey, retries = 1) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-service-key': serviceKey ?? '', 'x-correlation-id': randomUUID() },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      lastErr = new CoreCalendarError(`Core unreachable: ${err?.message}`);
      continue;
    }
    if (res.status >= 500) { await res.arrayBuffer?.().catch(() => {}); lastErr = new CoreCalendarError(`Core ${res.status}`); continue; }
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new CoreCalendarError(`Core ${res.status}: ${body?.error?.message ?? ''}`);
    if (!body || typeof body !== 'object') throw new CoreCalendarError('Core sent non-JSON');
    return body;
  }
  throw lastErr;
}

/** Manila date string YYYY-MM-DD from a JS Date (or now). */
export function manilaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}

/** Add `days` calendar days to a YYYY-MM-DD string and return the new YYYY-MM-DD. */
export function addCalendarDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}

/**
 * Build a CalendarClient.
 * @param {{ baseUrl?: string|null, serviceKey?: string }} opts
 */
export function createCalendarClient({ baseUrl = coreBase(), serviceKey = process.env.SERVICE_KEY } = {}) {
  const cache = new Map(); // key: `officeOrCampus|YYYY-MM-DD`

  async function isWorkingDay(date, officeId = null) {
    if (!baseUrl) throw new CoreCalendarError('CORE_URL is not configured');
    const key = `${officeId ?? 'campus'}|${date}`;
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({ date });
    if (officeId) params.set('officeId', officeId);
    const data = await fetchJson(`${baseUrl}/is-working-day?${params}`, serviceKey);
    const result = Boolean(data.is_working_day);
    cache.set(key, result);
    return result;
  }

  /**
   * Return the next `count` working day date strings after `fromDate` for the given office.
   * Scans up to `maxScan` calendar days ahead to avoid an infinite loop.
   */
  async function nextWorkingDays(fromDate, count, officeId = null, maxScan = 30) {
    const result = [];
    let cursor = fromDate;
    for (let i = 0; i < maxScan && result.length < count; i++) {
      cursor = addCalendarDays(cursor, 1);
      if (await isWorkingDay(cursor, officeId)) result.push(cursor);
    }
    return result;
  }

  return { isWorkingDay, nextWorkingDays };
}
