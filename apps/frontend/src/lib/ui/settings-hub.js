// The Settings hub (S8-13): one page that groups every setting a role can reach and links to the screen that already holds it.
// Pure data and one pure function, tested without a browser. The hub holds no form and sends nothing: each link opens the existing
// screen, which keeps using its own API, so no setting has a second copy. What a role may change is decided by the screens and
// by the services (they answer 403); the "Can change" / "View only" badge here only tells the person what to expect.
import { ROLES } from 'ccms-shared/roles';

const EVERYONE = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]);
const SUPER_ADMIN = Object.freeze([ROLES.SUPER_ADMIN]);

/**
 * id, title, description; items: { id, label, description, href, roles (who sees the item), editRoles (who can change it here; none
 * means it is read-only for everyone), requires ('clerk': only while Clerk sign-in is switched on) }.
 */
export const SETTINGS_GROUPS = Object.freeze([
  {
    id: 'general',
    title: 'General',
    description: 'The institution and its offices.',
    items: [
      { id: 'offices', label: 'Offices', description: 'The office list, the office codes and the institution code.', href: '/offices', roles: SUPER_ADMIN, editRoles: SUPER_ADMIN },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    description: 'How transactions behave.',
    items: [
      { id: 'transaction-settings', label: 'Transaction settings', description: 'Hold, counters and automatic closing of open transactions.', href: '/settings/transactions', roles: EVERYONE, editRoles: SUPER_ADMIN },
    ],
  },
  {
    id: 'calendar',
    title: 'Working hours and calendar',
    description: 'The hours and days CCCMS uses to compute deadlines (Asia/Manila).',
    items: [
      { id: 'working-hours', label: 'Working hours', description: 'The weekly schedule of the campus and of any office that has its own, with its lunch break.', href: '/calendar', roles: EVERYONE, editRoles: SUPER_ADMIN },
      { id: 'holidays', label: 'Holidays and suspensions', description: 'Holidays and suspensions on the campus calendar.', href: '/calendar?tab=holidays', roles: EVERYONE, editRoles: SUPER_ADMIN },
      { id: 'terms', label: 'Academic terms', description: 'Managed in the Syllabus Management System (SMS); shown here for reference.', href: '/calendar?tab=terms', roles: EVERYONE },
    ],
  },
  {
    id: 'access',
    title: 'Access and roles',
    description: 'Who can sign in, and what each role can do.',
    items: [
      { id: 'roles', label: 'Roles and permissions', description: 'The role table and the permission switches for Office Staff.', href: '/settings/roles', roles: SUPER_ADMIN, editRoles: SUPER_ADMIN },
      { id: 'accounts', label: 'Accounts', description: 'Create accounts, deactivate them and send password reset links.', href: '/accounts', roles: SUPER_ADMIN, editRoles: SUPER_ADMIN },
      { id: 'clerk', label: 'Clerk sign-in access', description: 'Approve the people who signed in with Clerk.', href: '/accounts?tab=clerk', roles: SUPER_ADMIN, editRoles: SUPER_ADMIN, requires: 'clerk' },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description: 'The systems CCCMS exchanges data with.',
    items: [
      { id: 'connected-systems', label: 'Connected systems', description: 'Whether the Faculty Management System and the Syllabus Management System received the calendar. It is the last panel on the Calendar page.', href: '/calendar', roles: SUPER_ADMIN },
    ],
  },
]);

export const ACCESS_LABEL = Object.freeze({ edit: 'Can change', view: 'View only' });

/**
 * The groups a role sees, each with only the items that role may open. An item is "edit" when the role can change it on its screen,
 * otherwise "view". A group with no item for the role is left out. `clerk` says whether Clerk sign-in is switched on.
 */
export function settingsHubForRole(role, { clerk = false } = {}) {
  return SETTINGS_GROUPS
    .map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      items: group.items
        .filter((item) => item.roles.includes(role) && (item.requires !== 'clerk' || clerk))
        .map((item) => ({ id: item.id, label: item.label, description: item.description, href: item.href, access: item.editRoles?.includes(role) ? 'edit' : 'view' })),
    }))
    .filter((group) => group.items.length > 0);
}
