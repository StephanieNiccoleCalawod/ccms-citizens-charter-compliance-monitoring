// The dedicated Account Settings sidebar (separate from the main CCMS sidebar, see AccountShell): one centralized,
// declarative list so an item is added, removed, relabeled, reordered, regrouped or disabled in one place instead of
// per-page navigation logic. Every href below is an existing route with its own existing page; nothing here renders
// a page of its own, and no route is duplicated.
import { ROLES } from 'ccms-shared/roles';

const ALL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE];
const ADMIN = [ROLES.SUPER_ADMIN];
const BELL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]; // the Executive has no notification bell
const ACCESS_ROLES = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF];

/** Heading of a sub-tree (items sharing `group`). It is a collapsible label only: no page, no route, no link. */
export const SUBGROUP_LABELS = Object.freeze({ workflow: 'Office & Access Management' });

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
    // Every Settings item opens its own dedicated route/page directly.
    items: [
      { id: 'institution-code', label: 'Institution code', href: '/settings/institution-code', roles: ADMIN, enabled: true },
      // Transaction settings, Roles and permissions, and Access requests are consecutive and share `group:
      // 'workflow'`, so AccountShell draws one subtle connector beside the three - they stay full, separate
      // pages/routes; this only changes how the sidebar visually relates them to each other.
      { id: 'transactions', label: 'Transaction settings', href: '/settings/transactions', roles: ALL, enabled: true, group: 'workflow' },
      { id: 'roles', label: 'Roles and permissions', href: '/settings/roles', roles: ADMIN, enabled: true, group: 'workflow' },
      { id: 'access', label: 'Access requests', href: '/access', roles: ACCESS_ROLES, enabled: true, group: 'workflow' },
      { id: 'notifications', label: 'Notification Center', href: '/settings/notifications', roles: BELL, enabled: true },
      { id: 'connected-systems', label: 'Connected systems', href: '/settings/connected-systems', roles: ADMIN, enabled: true },
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

/** The first Settings page a role can open (used by the account menu's "Settings" link and /settings redirect). */
export function defaultSettingsHref(role) {
  return accountNavGroups(role).find((g) => g.id === 'settings')?.items[0]?.href ?? null;
}

/** Every item a role sees, flattened, in configured order (for active-item matching). */
export function accountNavItems(role) {
  return accountNavGroups(role).flatMap((g) => g.items);
}

/**
 * Splits a group's items into render segments: a run of consecutive items sharing the same `group` tag becomes
 * one `{ kind: 'group', items }` segment (so the sidebar can draw one shared connector beside them); everything
 * else stays its own `{ kind: 'single', item }`. Purely a rendering hint - every item is still its own page and
 * route, and an item whose `group` sibling was filtered out for the role just renders alone.
 */
export function navSegments(items) {
  const segments = [];
  for (const item of items) {
    const last = segments[segments.length - 1];
    if (item.group && last?.kind === 'group' && last.groupKey === item.group) {
      last.items.push(item);
    } else if (item.group) {
      segments.push({ kind: 'group', groupKey: item.group, label: SUBGROUP_LABELS[item.group] ?? '', items: [item] });
    } else {
      segments.push({ kind: 'single', item });
    }
  }
  return segments;
}
