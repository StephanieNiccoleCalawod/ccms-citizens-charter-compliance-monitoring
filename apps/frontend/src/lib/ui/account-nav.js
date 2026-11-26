// The dedicated Account Settings sidebar (separate from the main CCMS sidebar, see AccountShell): one centralized,
// declarative list so an item is added, removed, relabeled, reordered, regrouped or disabled in one place instead of
// per-page navigation logic. Every href below is an existing route with its own existing page; nothing here renders
// a page of its own, and no route is duplicated.
import { ROLES } from 'ccms-shared/roles';

const ALL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE];
const ADMIN = [ROLES.SUPER_ADMIN];
const BELL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]; // the Executive has no notification bell
const ACCESS_ROLES = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF];

export const ACCOUNT_NAV_GROUPS = Object.freeze([
  {
    id: 'account',
    title: 'Account',
    collapsible: false,
    items: [{ id: 'my-account', label: 'My account', href: '/account', roles: ALL, enabled: true }],
  },
  {
    id: 'settings',
    title: 'Settings',
    collapsible: true,
    // Simple configuration settings (General, Transaction settings, Notification Center) stay a section of the one
    // scrollable /settings page: each names a `scrollId`, so on /settings itself the item scrolls to that section
    // instead of navigating (see AccountShell's `scrollSpy`); from anywhere else it still navigates to `href` as a
    // normal link. The remaining items are complex management pages with their own tables/workflows (Connected
    // systems, Roles and permissions, Access requests, Security and sessions) - they have no `scrollId` and are
    // never part of that scroll, even while on /settings: clicking them always navigates to their own route.
    items: [
      // "General" scrolls to the Offices section of /settings; its own content is Super Admin only.
      { id: 'general', label: 'General', href: '/settings', scrollId: 'offices', roles: ADMIN, enabled: true },
      { id: 'transactions', label: 'Transaction settings', href: '/settings/transactions', scrollId: 'transactions', roles: ALL, enabled: true },
      { id: 'notifications', label: 'Notification Center', href: '/settings/notifications', scrollId: 'notifications', roles: BELL, enabled: true },
      { id: 'connected-systems', label: 'Connected systems', href: '/settings/connected-systems', roles: ADMIN, enabled: true },
      { id: 'roles', label: 'Roles and permissions', href: '/settings/roles', roles: ADMIN, enabled: true },
      { id: 'access', label: 'Access requests', href: '/access', roles: ACCESS_ROLES, enabled: true },
      { id: 'security', label: 'Security and sessions', href: '/settings/security', roles: ADMIN, enabled: true },
    ],
  },
]);

/** The groups a role sees, each with only the enabled items that role may open. Empty groups are left out. */
export function accountNavGroups(role) {
  return ACCOUNT_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => item.enabled !== false && item.roles.includes(role) && (!item.match || item.match(role))) }))
    .filter((g) => g.items.length > 0);
}

/** Every item a role sees, flattened, in configured order (for active-item matching). */
export function accountNavItems(role) {
  return accountNavGroups(role).flatMap((g) => g.items);
}
