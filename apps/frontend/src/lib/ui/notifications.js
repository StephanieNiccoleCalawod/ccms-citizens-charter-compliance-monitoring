// Notification bell rules (CC055). Pure, so they are tested without a browser.
import { ROLES } from 'ccms-shared/roles';

export const BELL_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]); // the Executive has no bell
export const hasBell = (role) => BELL_ROLES.includes(role);
export const KIND_LABEL = Object.freeze({ OVERDUE: 'Overdue', DEADLINE: 'Deadline near', HIGH_RISK: 'High risk', COMPLAINT: 'Complaint', CALENDAR: 'Calendar', MANY_HIGH_RISK: 'Many likely late', VOLUME: 'Busy day' });
const RANK = { MANY_HIGH_RISK: -1, OVERDUE: 0, DEADLINE: 1, HIGH_RISK: 2 };

// How each kind looks on the bell: the left bar / icon colour (color), a darker shade for the label text (text) and the icon name.
export const KIND_STYLE = Object.freeze({
  DEADLINE: Object.freeze({ label: 'Deadline Notification', color: '#3B82F6', text: '#1D4ED8', icon: 'clock' }),
  OVERDUE: Object.freeze({ label: 'Overdue Notification', color: '#EF4444', text: '#B91C1C', icon: 'alert' }),
  HIGH_RISK: Object.freeze({ label: 'High Risk Notification', color: '#F97316', text: '#C2410C', icon: 'flag' }),
  COMPLAINT: Object.freeze({ label: 'Complaint Notification', color: '#22C55E', text: '#15803D', icon: 'check' }),
  CALENDAR: Object.freeze({ label: 'Calendar Notification', color: '#8B5CF6', text: '#6D28D9', icon: 'calendar' }),
  MANY_HIGH_RISK: Object.freeze({ label: 'Many Likely Late Notification', color: '#F97316', text: '#C2410C', icon: 'flag' }),
  VOLUME: Object.freeze({ label: 'Busy Day Notification', color: '#3B82F6', text: '#1D4ED8', icon: 'alert' }),
});
const OTHER_STYLE = Object.freeze({ color: '#64748B', text: '#334155', icon: 'bell' });
export const kindStyle = (kind) => KIND_STYLE[kind] ?? { ...OTHER_STYLE, label: KIND_LABEL[kind] ?? String(kind) };

export const FEEDS = Object.freeze(['oversight', 'operations']);
export const FEED_LABEL = Object.freeze({ oversight: 'Complaint and calendar notices', operations: 'Deadline and late-risk notices' });
export const READ_BATCH = 200; // the read endpoint accepts 1 to 200 keys per call

/**
 * feeds = { oversight, operations } as settled results. Urgent Operations notices first, then the rest newest first.
 * pendingReadKeys: keys marked read on this screen whose save is not yet confirmed by Oversight, so a poll that lands in between
 * does not turn them back into unread.
 */
export function mergeNotifications({ oversight, operations }, { pendingReadKeys = [] } = {}) {
  const readKeys = new Set([...(oversight?.status === 'fulfilled' ? oversight.value?.read_keys ?? [] : []), ...pendingReadKeys]);
  const ops = operations?.status === 'fulfilled' ? (operations.value?.items ?? []).map((i) => ({ ...i, read: readKeys.has(i.key) })) : [];
  const over = oversight?.status === 'fulfilled' ? (oversight.value?.items ?? []).map((i) => ({ ...i, read: Boolean(i.read) || readKeys.has(i.key) })) : [];
  ops.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.key.localeCompare(b.key));
  over.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key));
  return {
    items: [...ops, ...over],
    partial: oversight?.status === 'rejected' || operations?.status === 'rejected',
  };
}

/**
 * A feed that failed this time keeps its last good answer (so a short outage does not empty the bell or lose the read marks).
 * Returns the feeds to merge, the names of the feeds that failed now, and the new "last good" to keep for the next poll.
 */
export function withLastGood(feeds, previous = {}) {
  const effective = {};
  const failed = [];
  const good = { ...previous };
  for (const name of FEEDS) {
    const feed = feeds?.[name];
    if (feed?.status === 'fulfilled') { effective[name] = feed; good[name] = feed; } else { failed.push(name); effective[name] = previous[name] ?? feed ?? { status: 'rejected' }; }
  }
  return { feeds: effective, failed, good };
}

export const unavailableMessage = (failed = []) => {
  if (failed.length === 0) return '';
  const what = failed.length >= FEEDS.length ? 'Notifications' : FEED_LABEL[failed[0]];
  return `${what} could not be loaded right now. Some notices may be missing or out of date.`;
};
/** Splits keys into calls the read endpoint accepts (it takes at most 200 at a time). */
export const chunkKeys = (keys, size = READ_BATCH) => { const out = []; for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size)); return out; };
export const unreadItems = (items) => items.filter((i) => !i.read);
export const badgeText = (count) => (count > 99 ? '99+' : String(count));
export const markedAsRead = (items, keys) => { const set = new Set(keys); return items.map((i) => (set.has(i.key) ? { ...i, read: true } : i)); };

// S8-50: the "Needs attention" list on the Dashboard for the Office Head and the Super Admin. Only the office-level notices of the unusual-case
// rules: many likely-late at once, and an unusually busy day. One sentence and one action each; the sentence comes from the server.
export const ATTENTION_KINDS = Object.freeze({
  MANY_HIGH_RISK: Object.freeze({ action: 'Open Chance of finishing late', href: '/late-risk' }),
  VOLUME: Object.freeze({ action: 'See today\'s requests', href: '/transactions' }),
});
export const canSeeAttention = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD;
export const ATTENTION_EMPTY = 'Nothing needs your attention right now.';

export function attentionItems(items, role) {
  if (!canSeeAttention(role)) return [];
  return (items ?? []).filter((i) => ATTENTION_KINDS[i.kind]).map((i) => ({ key: i.key, kind: i.kind, text: i.text, ...ATTENTION_KINDS[i.kind] }));
}
