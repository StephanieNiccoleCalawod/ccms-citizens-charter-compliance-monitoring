// CC056: the calls behind My account and Settings > Roles and permissions.
import { apiFetch } from '../auth/session.js';
import { extraAccessKeys } from '../ui/access.js';
import { OFFICES_API } from './catalogue.js';
import { ME_API, MY_PASSWORD_API, PERMISSION_SWITCHES_API, SESSION_POLICY_API } from './identity.js';

export const getMe = (fetcher = apiFetch) => fetcher(ME_API);

/** The permission keys of the extra access the signed-in person holds, asked at most once a minute (several screens need it). */
let extraAccessCache = { at: 0, promise: null };
export function getExtraAccessKeys({ fetcher = apiFetch, now = Date.now, force = false } = {}) {
  if (!force && extraAccessCache.promise && now() - extraAccessCache.at < 60_000) return extraAccessCache.promise;
  const promise = getMe(fetcher).then(extraAccessKeys).catch(() => []);
  extraAccessCache = { at: now(), promise };
  return promise;
}

export const changeMyPassword = ({ current, next }, fetcher = apiFetch) =>
  fetcher(MY_PASSWORD_API, { method: 'PUT', body: { current_password: current, new_password: next } });

export const getSessionPolicy = (fetcher = apiFetch) => fetcher(SESSION_POLICY_API);

export const getPermissionSwitches = (fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API);

/** `changes` is { KEY: boolean } for only the switches that changed. */
export const savePermissionSwitches = (changes, fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API, { method: 'PUT', body: { switches: changes } });

/** The name of the person's own office (the account only holds its id). Empty when it cannot be read. */
export async function getOfficeName(officeId, fetcher = apiFetch) {
  const office = await fetcher(`${OFFICES_API}/${encodeURIComponent(officeId)}`);
  return office?.office_name ?? '';
}
