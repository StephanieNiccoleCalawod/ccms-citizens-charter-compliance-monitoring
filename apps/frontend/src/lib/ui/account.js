// CC056: the small rules behind My account and Roles and permissions, kept out of the components so they can be tested.
import { passwordStatus } from './password-guidance.js';
import { formatDateTime } from './date-format.js';

export const ACCESS_LABELS = Object.freeze({
  yes: 'Yes',
  no: 'No',
  'own office': 'Own office',
  'own records': 'Own records',
  'read only': 'Read only',
});

/** The words for one cell of the matrix / one "What I can do" line. A switch cell reads "Needs switch" or, when it is on, "Yes". */
export function accessLabel(cell) {
  if (cell && typeof cell === 'object') return 'Off unless switched on';
  return ACCESS_LABELS[cell] ?? 'No';
}

/** True when the role has any access at all in this cell. */
export const hasAccess = (cell) => !(cell === 'no' || cell === undefined || cell === null);

/** "What I can do" line: the access word, and for a staff switch whether it is on right now. */
export function myAccessLabel(item) {
  if (item.switch_key) return item.switch_on ? 'Yes (turned on by the Super Admin)' : 'Off (the Super Admin has not turned this on)';
  return ACCESS_LABELS[item.access] ?? 'No';
}

/** Groups rows in the order they first appear. */
export function groupRows(rows) {
  const groups = [];
  for (const row of rows ?? []) {
    let group = groups.find((g) => g.name === row.group);
    if (!group) groups.push((group = { name: row.group, rows: [] }));
    group.rows.push(row);
  }
  return groups;
}

export const LAST_SIGN_IN_NONE = 'No sign-in recorded yet';
export const lastSignIn = (iso) => (iso ? formatDateTime(iso) : LAST_SIGN_IN_NONE);

/** Up to two initials from a full name, for the small round avatar (the sidebar's account menu, My account). */
export function initials(name) {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Change-password form: only what the server would refuse, so the form is never stricter than Identity. Returns { field: message }. */
export function passwordFormErrors({ current, next, confirm }) {
  const errors = {};
  if (!current) errors.current = 'Enter your current password.';
  const status = passwordStatus(next);
  if (!next) errors.next = 'Enter a new password.';
  else if (status.blocking) errors.next = status.message;
  else if (next === current) errors.next = 'Choose a password different from the current one.';
  if (!confirm) errors.confirm = 'Enter the new password again.';
  else if (next !== confirm) errors.confirm = 'The two passwords do not match.';
  return errors;
}

/** The server's field messages (current_password / new_password) mapped to this form's fields. */
export function passwordServerErrors(details) {
  const out = {};
  if (details?.current_password) out.current = details.current_password;
  if (details?.new_password) out.next = details.new_password;
  return out;
}

/** Only the switches whose value differs from what the server last confirmed. */
export function switchChanges(saved, draft) {
  const changes = {};
  for (const [key, value] of Object.entries(draft ?? {})) if (saved?.[key] !== value) changes[key] = value;
  return changes;
}

export const switchValues = (switches) => Object.fromEntries((switches ?? []).map((s) => [s.key, s.enabled === true]));

/** Which switch-gated pages an Office Staff member may open now, from GET /me ("What I can do"). Anything unclear is "no". */
export function staffAccessFrom(me) {
  const on = (key) => (me?.what_i_can_do ?? []).some((item) => item.switch_key === key && item.switch_on === true);
  return { reports: on('STAFF_VIEW_REPORTS'), complaints: on('STAFF_VIEW_COMPLAINTS') };
}
