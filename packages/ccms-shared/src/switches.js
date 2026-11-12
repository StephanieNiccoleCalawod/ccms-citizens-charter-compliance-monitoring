import { Errors } from './errors.js';
import { ROLES } from './roles.js';
import { SWITCH_KEYS } from './capabilities.js';

// CC056: the four staff permission switches, checked on the server on every gated request. Identity owns the switches; Operations
// and Oversight ask it over the internal route (service key) and remember the answer for at most 10 seconds (TEAM DEFAULT), so a
// change by the Super Admin applies to the staff member's next request without a new sign-in. Identity unreachable or unreadable =
// every switch OFF (deny by default). A failed answer is remembered for only 2 seconds so recovery is quick.
export const SWITCH_CACHE_MS = 10_000;
const FAILURE_CACHE_MS = 2_000;
const allOff = () => Object.fromEntries(SWITCH_KEYS.map((key) => [key, false]));

export function identityBaseUrl(env = process.env) {
  const raw = String(env.IDENTITY_URL ?? env.IDENTITY_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

export function createSwitchGate({ env = process.env, fetchImpl = fetch, now = () => Date.now(), ttlMs = SWITCH_CACHE_MS, timeoutMs = 3000 } = {}) {
  let cached = null; // { at, ttl, value }
  let inflight = null;
  async function load() {
    const base = identityBaseUrl(env);
    if (!base || !env.SERVICE_KEY) return { value: allOff(), ttl: FAILURE_CACHE_MS };
    try {
      const response = await fetchImpl(`${base}/internal/permission-switches`, { headers: { accept: 'application/json', 'x-service-key': env.SERVICE_KEY }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { value: allOff(), ttl: FAILURE_CACHE_MS };
      const body = await response.json();
      const value = allOff();
      for (const key of SWITCH_KEYS) value[key] = body?.switches?.[key] === true; // anything but a literal true is off
      return { value, ttl: ttlMs };
    } catch {
      return { value: allOff(), ttl: FAILURE_CACHE_MS };
    }
  }
  async function all() {
    if (cached && now() - cached.at < cached.ttl) return cached.value;
    inflight ??= load().then((result) => { cached = { at: now(), ...result }; return result.value; }).finally(() => { inflight = null; });
    return inflight;
  }
  return {
    all,
    isEnabled: async (key) => SWITCH_KEYS.includes(key) && (await all())[key] === true,
    reset: () => { cached = null; },
  };
}

/**
 * Office Staff may do a gated action only when its switch is on. Every other role is not decided by a switch and passes
 * (their own rules apply elsewhere). 403 SWITCH_OFF otherwise, including when Identity cannot be reached.
 */
export async function requireSwitchForStaff(user, key, gate) {
  if (user?.role !== ROLES.OFFICE_STAFF) return;
  if (!(await gate.isEnabled(key))) throw Errors.forbidden('This action is not turned on for staff accounts. Ask your Super Admin.', 'SWITCH_OFF');
}
