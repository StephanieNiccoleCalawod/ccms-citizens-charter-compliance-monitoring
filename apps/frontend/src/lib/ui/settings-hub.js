// D8-20 / S8-13: the Settings hub is links only. Every setting is still changed in the form where it already lives, so no setting has a
// second form. Holidays and suspensions (daily work) and Accounts (provisioning) stay on their own pages and are not in the hub.
// A role sees only the links it may open; the services still answer 403 to a change the role may not make.
import { ROLES } from 'ccms-shared/roles';

const ALL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE];
const ADMIN = [ROLES.SUPER_ADMIN];
const BELL = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]; // the Executive has no notification bell

export const HUB_GROUPS = Object.freeze([
  { id: 'general', title: 'General', links: [
    { label: 'Offices', hint: 'The offices of the campus and their codes.', href: '/offices', roles: ADMIN },
  ] },
  { id: 'notifications', title: 'Notifications', links: [
    { label: 'Notification Center', hint: 'Every notice from the bell in one list: search, filter and mark as read.', href: '/settings/notifications', roles: BELL },
  ] },
  { id: 'transactions', title: 'Transactions', links: [
    { label: 'Transaction settings', hint: 'Hold, counters, automatic closing and which offices may record past transactions.', href: '/settings/transactions', roles: ALL, readOnlyFor: [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE] },
  ] },
  { id: 'calendar', title: 'Working hours and terms', links: [
    { label: 'Working hours and academic terms', hint: 'The campus and office schedules, and the terms from the Syllabus Management System.', href: '/calendar', roles: ALL, readOnlyFor: [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE] },
    { label: 'Connected systems', hint: 'Sync status of the Syllabus Management System and Faculty Management System.', href: '/settings/connected-systems', roles: ADMIN },
  ] },
  { id: 'access', title: 'Access and roles', links: [
    { label: 'Roles and permissions', hint: 'What each role may do, and the permission switches.', href: '/settings/roles', roles: ADMIN },
    { label: 'Access requests', hint: 'Decide who gets extra access, until when, and remove it.', href: '/access', roles: ADMIN },
    { label: 'Request access', hint: 'Ask the Super Admin for an extra permission for a limited time.', href: '/access', roles: [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF] },
  ] },
  { id: 'security', title: 'Security and sessions', links: [
    { label: 'Security and sessions', hint: 'How long a person can stay signed in.', href: '/settings/security', roles: ADMIN },
  ] },
]);

/** The groups a role sees, each with only the links that role may open. Empty groups are left out. */
export function hubGroups(role) {
  return HUB_GROUPS
    .map((g) => ({ ...g, links: g.links.filter((l) => l.roles.includes(role)).map((l) => ({ ...l, readOnly: (l.readOnlyFor ?? []).includes(role) })) }))
    .filter((g) => g.links.length > 0);
}

export const hubHasItems = (role) => hubGroups(role).length > 0;
