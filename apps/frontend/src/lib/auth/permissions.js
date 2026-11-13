// What a role may see and where it lands after sign-in. The role table lives in ccms-shared so the
// screens and the services agree; the services still enforce every rule on the server.
import { navForRole } from 'ccms-shared/nav';
import { ROLES } from 'ccms-shared/roles';
import { queueNav } from '../ui/queue.js';
import { clerkEnabled } from './provider.js';

export { landingForRole, navForRole } from 'ccms-shared/nav';
export { ROLE_LABELS } from 'ccms-shared/roles';

/**
 * Transaction Settings is a settings icon in the header of the Transactions page, so Super Admin, Office Head and Office Staff
 * get no sidebar item for it. Executive keeps the item with the reference pages: their Transactions page is read-only (CC027 / K14)
 * and they reach the settings, read-only, from the sidebar as before. Every role can open /settings (read-only unless Super Admin;
 * the Operations service enforces that).
 */
export function transactionSettingsNav(role) {
  if (role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD || role === ROLES.OFFICE_STAFF) return null;
  return { section: 'Reference', label: 'Transaction Settings', href: '/settings' };
}

/** The audit log is for Super Admin only: nobody else gets the menu item (the Logs service also answers 403 to Office Staff and Executive). */
export function logsNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Logs', href: '/logs' } : null;
}

/** Settings > Roles and permissions (CC056) is for Super Admin only: the four staff switches and the role matrix. The Identity service also answers 403 to everyone else. */
export function rolesNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Roles and permissions', href: '/settings/roles' } : null;
}

/**
 * Clerk sign-in access (Landas 1): the Super Admin approves people who signed in with Clerk. Shown only while Clerk sign-in is
 * switched on (NEXT_PUBLIC_AUTH_PROVIDER dual or clerk, with a publishable key); Identity answers 404/403 otherwise.
 */
export function clerkAccessNav(role) {
  return role === ROLES.SUPER_ADMIN && clerkEnabled() ? { section: 'Administration', label: 'Clerk sign-in access', href: '/settings/clerk-access' } : null;
}

/** The Student and Alumni Registry import (CC043) is for Super Admin only: nobody else gets the menu item (the page and the services check the role too). */
export function registryNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Registry', href: '/registry' } : null;
}

/** Roles with the Reports page (CC029-CC031). Office Staff get the item only while permission switch STAFF_VIEW_REPORTS is on (`access.reports`, from GET /me); Oversight answers 403 to them otherwise. */
export const REPORT_PAGE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]);
export const reportsNav = (role, access = {}) => (REPORT_PAGE_ROLES.includes(role) || (role === ROLES.OFFICE_STAFF && access.reports === true) ? { section: 'Main', label: 'Reports', href: '/reports' } : null);

/** Roles with the staff Complaints page (CC034 / CC035). Office Staff get the item only while switch STAFF_VIEW_COMPLAINTS is on (`access.complaints`, from GET /me); Oversight answers 403 to them otherwise. */
export const COMPLAINT_PAGE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]);
export const complaintsNav = (role, access = {}) => (COMPLAINT_PAGE_ROLES.includes(role) || (role === ROLES.OFFICE_STAFF && access.complaints === true) ? { section: 'Main', label: 'Complaints', href: '/complaints' } : null);

/** Roles with the Transactions list and detail. Executive is read-only (CC027 / K14): no start, hold, resume, complete or cancel. */
export const TRANSACTION_PAGE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]);
/** Roles that may start or act on a transaction (the Add Transaction page and the acknowledgement slip, which names the officer). */
export const TRANSACTION_OPERATOR_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

/**
 * The Transactions menu item. Starting a transaction is not a menu item: it is the "+ Add Transaction" button on that page, which
 * opens /transactions/new (operators only). The menu item is only a convenience: the Operations service decides which rows each
 * role may see and which fields an Executive gets, so hiding or showing the item is not the security boundary.
 */
export function transactionsNav(role) {
  return TRANSACTION_PAGE_ROLES.includes(role) ? { section: 'Main', label: 'Transactions', href: '/transactions' } : null;
}

/** CC027 / K14: the Executive reads transactions but never acts on them, and never sees staff, client or counter details. */
export const isTransactionReadOnly = (role) => role === ROLES.EXECUTIVE;

/** The menu item that is the current page: the longest address that matches (so /transactions/new and a transaction's page keep Transactions current). */
export function activeNavHref(items, pathname) {
  let best = null;
  for (const item of items ?? []) {
    const match = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
    if (match && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

/** The menu a signed-in role sees: the shared menu plus the pages the frontend adds (empty when the role is not recognized). */
export function appNavForRole(role, access = {}) {
  const shared = navForRole(role);
  if (shared.length === 0) return shared;
  const lateRisk = { section: 'Main', label: 'Late-risk', href: '/late-risk' };
  return [...shared, transactionsNav(role), queueNav(role), reportsNav(role, access), complaintsNav(role, access), lateRisk, transactionSettingsNav(role), registryNav(role), rolesNav(role), clerkAccessNav(role), logsNav(role)].filter(Boolean);
}
