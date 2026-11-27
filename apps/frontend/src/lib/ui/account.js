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

// S8-04: how this account signs in, from GET /me `sign_in` ({ clerk_linked, has_password }). Anything unclear keeps the password form,
// so a problem reading the link never hides the way to change a CCCMS password.
export const SIGN_IN_PASSWORD = 'Password';
export const SIGN_IN_CLERK = 'PUP QC account (Clerk)';
export const CLERK_PASSWORD_NOTE = 'Your password is managed in your PUP QC account, not in CCCMS. To change it, use the password option on the PUP QC sign-in page.';

/** True only when the account is linked to Clerk and has no CCCMS password of its own. */
export function isClerkOnly(signIn) {
  return signIn?.clerk_linked === true && signIn?.has_password === false;
}

/** The "Sign-in method" line: Password, PUP QC account (Clerk), or both while the account can use either. */
export function signInMethodLabel(signIn) {
  if (isClerkOnly(signIn)) return SIGN_IN_CLERK;
  if (signIn?.clerk_linked === true) return `${SIGN_IN_PASSWORD} or ${SIGN_IN_CLERK}`;
  return SIGN_IN_PASSWORD;
}

/** The CCCMS password form is shown for password accounts and while both ways work; hidden only for a Clerk-only account. */
export const showPasswordForm = (signIn) => !isClerkOnly(signIn);

/** A limit in minutes as people read it: 15 minutes, 4 hours, 1 hour 30 minutes. */
export function formatLimit(minutes) {
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return unit(rest, 'minute');
  return rest === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(rest, 'minute')}`;
}

export const SESSION_POLICY_OFF_NOTE = 'These limits are not being enforced yet. They apply once the sign-in limits are turned on for this system.';

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

export const SWITCH_SCOPE_ALL = 'ALL';
export const SWITCH_SCOPE_SPECIFIC = 'SPECIFIC';

export const switchScopeOf = (switchInfo) => (switchInfo?.scope === SWITCH_SCOPE_SPECIFIC ? SWITCH_SCOPE_SPECIFIC : SWITCH_SCOPE_ALL);

export const switchOfficeIdsOf = (switchInfo) => (
  switchScopeOf(switchInfo) === SWITCH_SCOPE_SPECIFIC && Array.isArray(switchInfo?.office_ids)
    ? [...new Set(switchInfo.office_ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean))].sort()
    : []
);

/**
 * Builds the PUT /permission-switches value for one switch from the confirmation modal. Uses the plain boolean
 * legacy shape when scope stays ALL so existing simple toggles keep their compact payload; sends the object shape
 * whenever SPECIFIC offices are chosen or when resetting a previously SPECIFIC switch back to ALL.
 */
export function buildSwitchUpdate({ nextEnabled, scope = SWITCH_SCOPE_ALL, officeIds = [], currentSwitch = null }) {
  const currentScope = switchScopeOf(currentSwitch);
  if (!nextEnabled) {
    return currentScope === SWITCH_SCOPE_SPECIFIC
      ? { enabled: false, scope: SWITCH_SCOPE_ALL, office_ids: [] }
      : false;
  }
  if (scope === SWITCH_SCOPE_SPECIFIC) {
    const cleanIds = [...new Set((officeIds ?? []).map((id) => String(id).trim().toLowerCase()).filter(Boolean))].sort();
    return { enabled: true, scope: SWITCH_SCOPE_SPECIFIC, office_ids: cleanIds };
  }
  return currentScope === SWITCH_SCOPE_SPECIFIC
    ? { enabled: true, scope: SWITCH_SCOPE_ALL, office_ids: [] }
    : true;
}

/** Short label + tooltip summarizing a switch's current office scope for the Roles matrix. */
export function switchScopeSummary(switchInfo, offices = []) {
  if (switchScopeOf(switchInfo) !== SWITCH_SCOPE_SPECIFIC) {
    return { label: 'All offices', title: 'Applies to Office Staff in all offices — click to change scope' };
  }
  const ids = switchOfficeIdsOf(switchInfo);
  const names = ids
    .map((id) => offices.find((o) => String(o.office_id).toLowerCase() === id)?.office_name)
    .filter(Boolean);
  const count = ids.length;
  return {
    label: `${count} ${count === 1 ? 'office' : 'offices'}`,
    title: names.length > 0 ? `${names.join(', ')} — click to edit offices` : `${count} selected ${count === 1 ? 'office' : 'offices'} — click to edit`,
  };
}

/** Which switch-gated pages an Office Staff member may open now, from GET /me ("What I can do"). Anything unclear is "no". */
export function staffAccessFrom(me) {
  const on = (key) => (me?.what_i_can_do ?? []).some((item) => item.switch_key === key && item.switch_on === true);
  // S8-52: a granted "Reports per person" opens the Reports page too (the server lets that person read the people report without the switch).
  const granted = (me?.extra_access ?? []).some((g) => g.permission_key === 'REPORTS_PER_PERSON');
  return { reports: on('STAFF_VIEW_REPORTS') || granted, complaints: on('STAFF_VIEW_COMPLAINTS') };
}

export const ROLE_META = Object.freeze({
  super_admin: { description: 'Full campus control', dotClass: 'bg-[#800000]', headerToneClass: 'bg-white' },
  office_head: { description: 'Unit supervisor', dotClass: 'bg-blue-600', headerToneClass: 'bg-white' },
  office_staff: { description: 'Counter operators', dotClass: 'bg-amber-500', headerToneClass: 'bg-white' },
  executive: { description: 'Campus leadership', dotClass: 'bg-purple-600', headerToneClass: 'bg-white' },
});

export function roleMeta(role) {
  return ROLE_META[role] ?? { description: 'System role', dotClass: 'bg-slate-400', headerToneClass: 'bg-white' };
}

/** True when any role cell in this capability row is gated by a configurable switch object. */
export function isSwitchControlledRow(row) {
  return Object.values(row?.cells ?? {}).some((cell) => Boolean(cell && typeof cell === 'object' && cell.switch));
}

/** Switch keys referenced by any role cell in this capability row. */
export function rowSwitchKeys(row) {
  const keys = [];
  for (const cell of Object.values(row?.cells ?? {})) {
    if (cell && typeof cell === 'object' && cell.switch && !keys.includes(cell.switch)) {
      keys.push(cell.switch);
    }
  }
  return keys;
}

/** Number of capabilities in the matrix that depend on a configurable switch. */
export function countSwitchControlledRows(rows) {
  return (rows ?? []).filter(isSwitchControlledRow).length;
}

/** Preserves group order from matrix.rows and returns total + [{ name, count }]. */
export function summarizeCategories(rows) {
  const groups = groupRows(rows ?? []);
  return {
    total: (rows ?? []).length,
    categories: groups.map((g) => ({ name: g.name, count: g.rows.length })),
  };
}

/**
 * Filters capability rows by selected category tab and search query (matches capability label,
 * module group name, capability identifier key, and linked switch description).
 */
export function filterCapabilityRows(rows, { category = 'ALL', query = '', switches = [] } = {}) {
  const switchMap = new Map((switches ?? []).map((s) => [s.key, s]));
  const needle = String(query ?? '').trim().toLowerCase();
  return (rows ?? []).filter((row) => {
    if (category && category !== 'ALL' && row.group !== category) return false;
    if (!needle) return true;
    const linkedInfo = rowSwitchKeys(row)
      .map((k) => {
        const s = switchMap.get(k);
        return s ? `${k} ${s.label} ${s.description ?? ''}` : k;
      })
      .join(' ');
    const haystack = `${row.label ?? ''} ${row.group ?? ''} ${row.key ?? ''} ${linkedInfo}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Maps an actual backend cell value ('yes' | 'own office' | 'own records' | 'read only' | 'no' | { switch })
 * to semantic badge metadata without inventing or altering any permission state.
 */
export function accessBadgeMeta(cell, switchOn = {}) {
  if (cell && typeof cell === 'object' && cell.switch) {
    const enabled = switchOn?.[cell.switch] === true;
    return enabled
      ? {
          kind: 'switch_on',
          label: 'Yes (switch on)',
          shortLabel: 'Yes',
          tooltip: 'Enabled via configurable staff permission switch',
          className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        }
      : {
          kind: 'switch_off',
          label: 'Off (switch off)',
          shortLabel: 'Off (switch off)',
          tooltip: 'Configurable staff permission switch is currently off',
          className: 'border-[#F0DDB0] bg-[#FFFBEB] text-[#B45309]',
        };
  }
  switch (cell) {
    case 'yes':
      return {
        kind: 'yes',
        label: 'Yes',
        shortLabel: 'Yes',
        tooltip: 'Permission is fully granted',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    case 'own office':
      return {
        kind: 'own_office',
        label: 'Own office',
        shortLabel: 'Own office',
        tooltip: "Access is limited to the user's assigned office",
        className: 'border-blue-200 bg-blue-50 text-blue-700',
      };
    case 'own records':
      return {
        kind: 'own_records',
        label: 'Own records',
        shortLabel: 'Own records',
        tooltip: "Access is restricted to the user's own records",
        className: 'border-teal-200 bg-teal-50 text-teal-700',
      };
    case 'read only':
      return {
        kind: 'read_only',
        label: 'Read only',
        shortLabel: 'Read only',
        tooltip: 'Viewing is allowed without modification',
        className: 'border-purple-200 bg-purple-50 text-purple-700',
      };
    default:
      return {
        kind: 'no',
        label: 'No',
        shortLabel: 'No',
        tooltip: 'Permission is not granted',
        className: 'text-slate-400',
      };
  }
}

/** True when a single role cell is controlled by an existing configurable switch. */
export function isSwitchCell(cell) {
  return Boolean(cell && typeof cell === 'object' && typeof cell.switch === 'string' && cell.switch);
}

/**
 * Inspects the permission matrix to identify every role affected by a given configurable switch key,
 * preserving the actual role-configuration model rather than hardcoding a single role.
 */
export function affectedRolesForSwitch(matrix, switchKey) {
  if (!matrix || !switchKey) return [];
  const roles = matrix.roles ?? [];
  const rows = matrix.rows ?? [];
  const matchedRoleKeys = new Set();
  for (const r of rows) {
    for (const [roleKey, cell] of Object.entries(r?.cells ?? {})) {
      if (isSwitchCell(cell) && cell.switch === switchKey) {
        matchedRoleKeys.add(roleKey);
      }
    }
  }
  return roles.filter((r) => matchedRoleKeys.has(r.role));
}
