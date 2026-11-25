// Request Access (S8-52 / D-AC-4). Only these four permissions can be asked for. The server decides everything again; the screen
// only guides. The list below mirrors ccms-shared (a test keeps them the same).
import { ROLES } from 'ccms-shared/roles';

export const GRANTABLE = Object.freeze([
  { key: 'REPORTS_PER_PERSON', label: 'Reports per person', description: 'See the report of one person or of every staff member of your office.' },
  { key: 'RECORD_PAST_TRANSACTIONS', label: 'Record past transactions', description: 'Record a transaction that already happened, in your own office.' },
  { key: 'EXPORT_CSV', label: 'Export reports to CSV', description: 'Download a report as a CSV file.' },
  { key: 'VIEW_OFFICE_QUEUE', label: 'View other staff’s queue', description: 'See the queue of the other staff of your office.' },
]);
export const GRANT_DEFAULT_DAYS = 30;
export const GRANT_MAX_DAYS = 90;
export const REASON_MAX = 500;
export const STATUS_LABEL = Object.freeze({ PENDING: 'Waiting', GRANTED: 'Approved', DENIED: 'Not approved', REVOKED: 'Removed', EXPIRED: 'Ended' });
export const STATUS_TONE = Object.freeze({ PENDING: 'warning', GRANTED: 'success', DENIED: 'danger', REVOKED: 'neutral', EXPIRED: 'neutral' });

export const permissionLabel = (key) => GRANTABLE.find((g) => g.key === key)?.label ?? 'An extra permission';
export const canRequestAccess = (role) => role === ROLES.OFFICE_HEAD || role === ROLES.OFFICE_STAFF;
export const canManageAccess = (role) => role === ROLES.SUPER_ADMIN;

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** The end date offered first (30 days from today), and the first and last day the Super Admin may choose. */
export const defaultEndsOn = (today) => addDays(today, GRANT_DEFAULT_DAYS);
export const endsOnBounds = (today) => ({ min: addDays(today, 1), max: addDays(today, GRANT_MAX_DAYS) });

/** Early feedback on the Super Admin's end date; the server checks again. '' when fine. */
export function endsOnError(value, today) {
  if (!value) return 'Choose the last day of this access. It cannot be left empty.';
  const { min, max } = endsOnBounds(today);
  if (value < min) return 'The end date must be after today.';
  if (value > max) return `Access can last at most ${GRANT_MAX_DAYS} days. A longer time needs a new request.`;
  return '';
}

export function requestError({ permissionKey, reason }) {
  const errors = {};
  if (!GRANTABLE.some((g) => g.key === permissionKey)) errors.permissionKey = 'Choose what you need access to.';
  const text = String(reason ?? '').trim();
  if (!text) errors.reason = 'Write why you need this access.';
  else if (text.length > REASON_MAX) errors.reason = `Keep the reason within ${REASON_MAX} characters.`;
  return errors;
}

export function accessFailureMessage(failure) {
  if (failure?.status === 403) return 'You are not allowed to do this.';
  if (failure?.status === 409) return failure.message || 'This was already decided or already exists.';
  if (failure?.status === 400) return failure.message || 'Check what you entered and try again.';
  return 'This could not be done right now. Nothing was changed. Please try again.';
}

export const REQUEST_SENT = Object.freeze({ title: 'Request sent', message: 'The Super Admin will decide. You will see the answer in your notifications.' });
export const LOCKED_HINT = 'You don’t have access to this yet.';
export const accessLink = (permissionKey) => `/access${permissionKey ? `?permission=${encodeURIComponent(permissionKey)}` : ''}`;

/** The permission keys a person holds right now, from GET /me ("extra_access"). Anything unclear is "none". */
export const extraAccessKeys = (me) => (Array.isArray(me?.extra_access) ? me.extra_access.map((g) => g.permission_key).filter(Boolean) : []);
export const hasExtraAccess = (keys, permissionKey) => (keys ?? []).includes(permissionKey);
/** The "Request access" notice for a locked feature, or null for a role that cannot ask (the Super Admin, the Executive). */
export const lockedNotice = (permissionKey, role, message = LOCKED_HINT) => (canRequestAccess(role) ? { message, action: 'Request access', href: accessLink(permissionKey) } : null);

