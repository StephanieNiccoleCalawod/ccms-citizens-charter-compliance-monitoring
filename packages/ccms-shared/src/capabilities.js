import { ROLES } from './roles.js';

// The role rule table (CC056): what each role can do, written once. "My account > What I can do" and the Roles and permissions
// matrix are both built from it, so the two never disagree. The services still enforce every rule themselves; this table describes
// them, it does not grant anything. NEEDS REVIEW against the RBAC document before the demo (K12/K13): rows are taken from the
// routes as they are built today.
//
// A cell is one of: 'yes', 'no', 'own office', 'own records', 'read only', or { switch: KEY } (Office Staff only, off by default).
export const SWITCH_KEYS = Object.freeze(['STAFF_HOLD_RESUME', 'STAFF_BACKDATE', 'STAFF_VIEW_COMPLAINTS', 'STAFF_VIEW_REPORTS']);

export const SWITCH_INFO = Object.freeze({
  STAFF_HOLD_RESUME: { label: 'Staff can hold and resume transactions', description: 'Lets Office Staff put a transaction on hold and resume it.' },
  STAFF_BACKDATE: { label: 'Staff can record past transactions', description: 'Lets Office Staff enter a transaction with an earlier start and end time (with a reason).' },
  STAFF_VIEW_COMPLAINTS: { label: 'Staff can view complaints', description: 'Lets Office Staff see the complaints filed against their office.' },
  STAFF_VIEW_REPORTS: { label: 'Staff can view reports', description: 'Lets Office Staff read their office’s reports.' },
});

const { SUPER_ADMIN: SA, OFFICE_HEAD: OH, OFFICE_STAFF: OS, EXECUTIVE: EX } = ROLES;
const row = (key, group, label, sa, oh, os, ex) => Object.freeze({ key, group, label, cells: Object.freeze({ [SA]: sa, [OH]: oh, [OS]: os, [EX]: ex }) });

export const CAPABILITIES = Object.freeze([
  row('accounts', 'Administration', 'Create and manage accounts', 'yes', 'no', 'no', 'no'),
  row('accounts.view', 'Administration', 'View accounts', 'yes', 'own office', 'no', 'read only'),
  row('offices', 'Administration', 'Create and manage offices', 'yes', 'no', 'no', 'no'),
  row('services', 'Reference', 'Create and manage services and standards', 'yes', 'no', 'no', 'no'),
  row('services.view', 'Reference', 'View services and standards', 'yes', 'yes', 'yes', 'yes'),
  row('calendar', 'Reference', 'Manage the calendar and office hours', 'yes', 'no', 'no', 'no'),
  row('calendar.view', 'Reference', 'View the calendar', 'yes', 'yes', 'yes', 'yes'),
  row('registry', 'Administration', 'Import the student and alumni registry', 'yes', 'no', 'no', 'no'),
  row('logs', 'Administration', 'View the audit log', 'yes', 'no', 'no', 'no'),
  row('tx.start', 'Transactions', 'Start and complete a transaction', 'yes', 'own office', 'own records', 'no'),
  row('tx.hold', 'Transactions', 'Hold and resume a transaction', 'yes', 'own office', { switch: 'STAFF_HOLD_RESUME' }, 'no'),
  row('tx.backdate', 'Transactions', 'Record a transaction with past dates', 'yes', 'own office', { switch: 'STAFF_BACKDATE' }, 'no'),
  row('tx.cancel', 'Transactions', 'Cancel a transaction', 'yes', 'own office', 'no', 'no'),
  row('tx.view', 'Transactions', 'View transactions', 'yes', 'own office', 'own records', 'read only'),
  row('insights', 'Insights', 'View the Insights dashboard', 'yes', 'own office', 'own office', 'yes'),
  row('reports', 'Reports', 'Read office reports', 'yes', 'own office', { switch: 'STAFF_VIEW_REPORTS' }, 'read only'),
  row('complaints', 'Complaints', 'View complaints', 'yes', 'own office', { switch: 'STAFF_VIEW_COMPLAINTS' }, 'read only'),
  row('permissions', 'Administration', 'Change the four staff permission switches', 'yes', 'no', 'no', 'no'),
]);

/** One role's column: [{ key, group, label, access, switchKey }]. `switches` is { KEY: boolean }; a missing switch counts as off. */
export function capabilitiesFor(role, switches = {}) {
  return CAPABILITIES.map((c) => {
    const cell = c.cells[role] ?? 'no';
    if (cell && typeof cell === 'object') {
      return { key: c.key, group: c.group, label: c.label, access: switches[cell.switch] === true ? 'yes' : 'no', switchKey: cell.switch, switchOn: switches[cell.switch] === true };
    }
    return { key: c.key, group: c.group, label: c.label, access: cell, switchKey: null, switchOn: null };
  });
}
