import { Errors } from './errors.js';
import { ROLES } from './roles.js';
import { identityBaseUrl } from './switches.js';
import { isValidManilaDate, toManilaDate } from './time.js';

// S8-52 / D-AC-4: time-limited extra permissions an Office Head or Office Staff member can ask for and the Super Admin can grant.
// Only these four can be requested. Super-Admin-only actions are never grantable, and a grant never crosses office scope.
export const GRANTABLE = Object.freeze({
  REPORTS_PER_PERSON: Object.freeze({ label: 'Reports per person', description: 'See the report of one person or of every staff member of your office.' }),
  RECORD_PAST_TRANSACTIONS: Object.freeze({ label: 'Record past transactions', description: 'Record a transaction that already happened, in your own office.' }),
  EXPORT_CSV: Object.freeze({ label: 'Export reports to CSV', description: 'Download a report as a CSV file.' }),
  VIEW_OFFICE_QUEUE: Object.freeze({ label: 'View other staff’s queue', description: 'See the queue of the other staff of your office.' }),
});
export const GRANTABLE_KEYS = Object.freeze(Object.keys(GRANTABLE));
export const isGrantable = (key) => GRANTABLE_KEYS.includes(key);

export const GRANT_DEFAULT_DAYS = 30;
export const GRANT_MAX_DAYS = 90;
export const REQUESTER_ROLES = Object.freeze([ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

export function addDaysToDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The end date of a grant. Left out: 30 days from today. Given: a real date after today and at most 90 days from today.
 * An empty value is refused: every grant has an end date (the last day the access works, Manila time).
 */
export function resolveEndsOn(input, today = toManilaDate(new Date())) {
  if (input === undefined) return addDaysToDate(today, GRANT_DEFAULT_DAYS);
  const max = addDaysToDate(today, GRANT_MAX_DAYS);
  const bad = (message) => Errors.validation(message, { ends_on: message });
  if (input === null || input === '' || typeof input !== 'string') throw bad('Choose the last day of this access. It cannot be left empty.');
  if (!isValidManilaDate(input)) throw bad('Choose a valid end date.');
  if (input <= today) throw bad('The end date must be after today.');
  if (input > max) throw bad(`Access can last at most ${GRANT_MAX_DAYS} days. A longer time needs a new request.`);
  return input;
}

const GRANT_CACHE_MS = 10_000;
const FAILURE_CACHE_MS = 2_000;

/**
 * Asks Identity (over the internal route) which extra permissions a person has right now. Remembered for 10 seconds per person, so a
 * revoke applies on the next request after that. Identity unreachable or unreadable = no grants (deny by default).
 */
export function createGrantGate({ env = process.env, fetchImpl = fetch, now = () => Date.now(), ttlMs = GRANT_CACHE_MS, timeoutMs = 3000 } = {}) {
  const cache = new Map(); // account id -> { at, ttl, keys }
  async function keysFor(user) {
    const id = String(user?.id ?? '').toLowerCase();
    if (!id) return new Set();
    const hit = cache.get(id);
    if (hit && now() - hit.at < hit.ttl) return hit.keys;
    let keys = new Set(); let ttl = FAILURE_CACHE_MS;
    try {
      const base = identityBaseUrl(env);
      if (base && env.SERVICE_KEY) {
        const response = await fetchImpl(`${base}/internal/account-grants?account_id=${encodeURIComponent(id)}`, { headers: { accept: 'application/json', 'x-service-key': env.SERVICE_KEY }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          const body = await response.json();
          const office = String(user.officeId ?? '').toLowerCase();
          keys = new Set((body?.grants ?? []).filter((g) => isGrantable(g.permission_key) && office && String(g.office_id ?? '').toLowerCase() === office).map((g) => g.permission_key));
          ttl = ttlMs;
        }
      }
    } catch { /* deny by default */ }
    cache.set(id, { at: now(), ttl, keys });
    return keys;
  }
  return { has: async (user, key) => isGrantable(key) && (await keysFor(user)).has(key), reset: () => cache.clear() };
}

let sharedGate = null;
export const getGrantGate = () => (sharedGate ??= createGrantGate());
export const setGrantGate = (replacement) => { sharedGate = replacement; };
/** True when the person has an active grant for the permission, in the office they work in. Never true for a key that is not grantable. */
export const hasGrant = (user, key) => getGrantGate().has(user, key);
