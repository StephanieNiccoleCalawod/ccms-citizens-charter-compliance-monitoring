// CC056: the calls behind My account and Settings > Roles and permissions.
import { apiFetch } from '../auth/session.js';
import { OFFICES_API } from './catalogue.js';
import { ME_API, MY_PASSWORD_API, PERMISSION_SWITCHES_API } from './identity.js';

export const getMe = (fetcher = apiFetch) => fetcher(ME_API);

export const changeMyPassword = ({ current, next }, fetcher = apiFetch) =>
  fetcher(MY_PASSWORD_API, { method: 'PUT', body: { current_password: current, new_password: next } });

export const getPermissionSwitches = (fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API);

/** `changes` is { KEY: boolean } for only the switches that changed. */
export const savePermissionSwitches = (changes, fetcher = apiFetch) => fetcher(PERMISSION_SWITCHES_API, { method: 'PUT', body: { switches: changes } });

/** The name of the person's own office (the account only holds its id). Empty when it cannot be read. */
export async function getOfficeName(officeId, fetcher = apiFetch) {
  const office = await fetcher(`${OFFICES_API}/${encodeURIComponent(officeId)}`);
  return office?.office_name ?? '';
}
