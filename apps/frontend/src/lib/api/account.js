// CC056: the calls behind My account and Settings > Roles and permissions.
import { apiFetch } from '../auth/session.js';
import { extraAccessKeys } from '../ui/access.js';
import { OFFICES_API } from './catalogue.js';
import { ME_API, MY_PASSWORD_API, PERMISSION_SWITCHES_API, SESSION_POLICY_API } from './identity.js';

export const getMe = (fetcher = apiFetch) => fetcher(ME_API);

/** Cached GET /me (asked at most once a minute) so screens can read both extra_access and office-scoped switches. */
let meCache = { at: 0, promise: null };
export function getCachedMe({ fetcher = apiFetch, now = Date.now, force = false } = {}) {
  if (!force && meCache.promise && now() - meCache.at < 60_000) return meCache.promise;
  const promise = getMe(fetcher).catch(() => null);
  meCache = { at: now(), promise };
  return promise;
}

/** The permission keys of the extra access the signed-in person holds, asked at most once a minute (several screens need it). */
export function getExtraAccessKeys(options) {
  return getCachedMe(options).then(extraAccessKeys);
}

export const changeMyPassword = ({ current, next }, fetcher = apiFetch) =>
  fetcher(MY_PASSWORD_API, { method: 'PUT', body: { current_password: current, new_password: next } });

export const getSessionPolicy = (fetcher = apiFetch) => fetcher(SESSION_POLICY_API);

export const getPermissionSwitches = (fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API);

/** `changes` is { KEY: boolean | { enabled, scope, office_ids } } for only the switches that changed. */
export const savePermissionSwitches = (changes, fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API, { method: 'PUT', body: { switches: changes } });

/** The name of the person's own office (the account only holds its id). Empty when it cannot be read. */
export async function getOfficeName(officeId, fetcher = apiFetch) {
  const office = await fetcher(`${OFFICES_API}/${encodeURIComponent(officeId)}`);
  return office?.office_name ?? '';
}
