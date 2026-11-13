// Notification bell rules (CC055). Pure, so they are tested without a browser.
import { ROLES } from 'ccms-shared/roles';

export const BELL_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]); // the Executive has no bell
export const hasBell = (role) => BELL_ROLES.includes(role);
export const KIND_LABEL = Object.freeze({ OVERDUE: 'Overdue', DEADLINE: 'Deadline near', HIGH_RISK: 'High risk', COMPLAINT: 'Complaint', CALENDAR: 'Calendar' });
const RANK = { OVERDUE: 0, DEADLINE: 1, HIGH_RISK: 2 };

/** feeds = { oversight, operations } as settled results. Urgent Operations notices first, then the rest newest first. */
export function mergeNotifications({ oversight, operations }) {
  const readKeys = new Set(oversight?.status === 'fulfilled' ? oversight.value?.read_keys ?? [] : []);
  const ops = operations?.status === 'fulfilled' ? (operations.value?.items ?? []).map((i) => ({ ...i, read: readKeys.has(i.key) })) : [];
  const over = oversight?.status === 'fulfilled' ? oversight.value?.items ?? [] : [];
  ops.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.key.localeCompare(b.key));
  over.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key));
  return {
    items: [...ops, ...over],
    partial: oversight?.status === 'rejected' || operations?.status === 'rejected',
  };
}
export const unreadItems = (items) => items.filter((i) => !i.read);
export const badgeText = (count) => (count > 99 ? '99+' : String(count));
export const markedAsRead = (items, keys) => { const set = new Set(keys); return items.map((i) => (set.has(i.key) ? { ...i, read: true } : i)); };
