// What a role may see and where it lands after sign-in. The role table lives in ccms-shared so the
// screens and the services agree; the services still enforce every rule on the server.
import { navForRole } from 'ccms-shared/nav';
import { ROLES } from 'ccms-shared/roles';

export { landingForRole, navForRole } from 'ccms-shared/nav';
export { ROLE_LABELS } from 'ccms-shared/roles';

/**
 * Transaction Settings is a settings icon in the header of the Transactions page (Super Admin, Office Head and Office Staff), so
 * those roles get no sidebar item for it. Executive has no Transactions page, so keeps the item with the reference pages. Every
 * role can open /settings (read-only unless Super Admin; the Operations service enforces that).
 */
export function transactionSettingsNav(role) {
  if (role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD || role === ROLES.OFFICE_STAFF) return null;
  return { section: 'Reference', label: 'Transaction Settings', href: '/settings' };
}

/** The audit log is for Super Admin only: nobody else gets the menu item (the Logs service also answers 403 to Office Staff and Executive). */
export function logsNav(role) {
  return role === ROLES.SUPER_ADMIN ? { section: 'Administration', label: 'Logs', href: '/logs' } : null;
}

/**
 * The Transactions list is for Super Admin, Office Head and Office Staff. Starting a transaction is no longer a menu item: it is the
 * "+ Add Transaction" button on that page, which opens /transactions/new (that page is limited to the same roles).
 * The Transactions list is for the same roles. The menu item is only a convenience: the Operations service decides which
 * rows each role may see (and answers 403 to Executive), so hiding the item is not the security boundary.
 */
export function transactionsNav(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD || role === ROLES.OFFICE_STAFF ? { section: 'Main', label: 'Transactions', href: '/transactions' } : null;
}

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
export function appNavForRole(role) {
  const shared = navForRole(role);
  if (shared.length === 0) return shared;
  return [...shared, transactionsNav(role), transactionSettingsNav(role), logsNav(role)].filter(Boolean);
}
