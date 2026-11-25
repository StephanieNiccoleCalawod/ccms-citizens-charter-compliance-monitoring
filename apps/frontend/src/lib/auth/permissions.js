// What a role may see and where it lands after sign-in. The role table lives in ccms-shared so the
// screens and the services agree; the services still enforce every rule on the server.
import { navForRole } from 'ccms-shared/nav';
import { ROLES } from 'ccms-shared/roles';
import { queueNav } from '../ui/queue.js';
import { clerkEnabled } from './provider.js';
import { hubHasItems } from '../ui/settings-hub.js';

export { landingForRole, navForRole } from 'ccms-shared/nav';
export { ROLE_LABELS } from 'ccms-shared/roles';

/**
 * The Settings item (D8-20): shown to a role only when the Settings hub has something for it. Every role has at least the read-only
 * transaction settings, so each role gets it; the item sits with the reference pages. The header icon on the Transactions page opens
 * the transaction settings directly (/settings/transactions).
 */
export function transactionSettingsNav(role) {
  return hubHasItems(role) ? { section: 'Reference', label: 'Settings', href: '/settings' } : null;
}

/** The audit log is for Super Admin only: nobody else gets the menu item (the Logs service also answers 403 to Office Staff and Executive). */
export function logsNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Logs', href: '/logs' } : null;
}

/** Settings > Roles and permissions (CC056) is for Super Admin only: the four staff switches and the role matrix. The Identity service also answers 403 to everyone else. */
export function rolesNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Roles and permissions', href: '/settings/roles' } : null;
}

/** Settings > Security and sessions (S8-34) is for Super Admin only: the idle and total sign-in limits enforced for every role, read-only. Identity also answers 403 to everyone else. */
export function securityNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Security and sessions', href: '/settings/security' } : null;
}

/**
 * Clerk sign-in access (Landas 1): the Super Admin approves people who signed in with Clerk. It lives in the Accounts page's
 * own "Clerk Sign-in Access" tab now, not a sidebar item of its own, so this no longer feeds appNavForRole; kept for the
 * Accounts page (and old links to /settings/clerk-access) to ask the same question: is Clerk switched on for this role.
 * (NEXT_PUBLIC_AUTH_PROVIDER dual or clerk, with a publishable key); Identity answers 404/403 otherwise.
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
  const lateRisk = { section: 'Main', label: 'Chance of finishing late', href: '/late-risk' };
  return [...shared, transactionsNav(role), queueNav(role), reportsNav(role, access), complaintsNav(role, access), lateRisk, transactionSettingsNav(role), registryNav(role), rolesNav(role), securityNav(role), logsNav(role)].filter(Boolean);
}
