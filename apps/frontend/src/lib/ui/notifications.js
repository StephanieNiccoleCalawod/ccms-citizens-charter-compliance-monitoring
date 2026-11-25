// Notification bell rules (CC055). Pure, so they are tested without a browser.
import { ROLES } from 'ccms-shared/roles';

export const BELL_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]); // the Executive has no bell
export const hasBell = (role) => BELL_ROLES.includes(role);
export const KIND_LABEL = Object.freeze({ OVERDUE: 'Overdue', DEADLINE: 'Deadline near', HIGH_RISK: 'High risk', COMPLAINT: 'Complaint', CALENDAR: 'Calendar', MANY_HIGH_RISK: 'Many likely late', VOLUME: 'Busy day', ACCESS: 'Access' });
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
  ACCESS: Object.freeze({ label: 'Access Notification', color: '#8B5CF6', text: '#6D28D9', icon: 'check' }),
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

// The full Notification Center (Settings > Notification Center): the same notices as the bell, with a search box and the same filter tabs.
export const FULL_CENTER_HREF = '/settings/notifications';
const DEADLINE_KINDS = ['OVERDUE', 'DEADLINE', 'HIGH_RISK'];
export const NOTICE_TABS = Object.freeze([
  { id: 'all', label: 'All', pick: () => true },
  { id: 'unread', label: 'Unread', pick: (i) => !i.read },
  { id: 'deadlines', label: 'Deadlines', pick: (i) => DEADLINE_KINDS.includes(i.kind) },
  { id: 'updates', label: 'Updates', pick: (i) => !DEADLINE_KINDS.includes(i.kind) },
]);
/** The notices a tab and a search show. The search looks at the title, the sentence and the key, ignoring case. Nothing is fetched or saved. */
export function filterNotices(items, tabId = 'all', query = '') {
  const tab = NOTICE_TABS.find((t) => t.id === tabId) ?? NOTICE_TABS[0];
  const q = String(query ?? '').trim().toLowerCase();
  return items.filter(tab.pick).filter((i) => !q || [kindStyle(i.kind).label, i.text, i.key].some((v) => String(v ?? '').toLowerCase().includes(q)));
}
/** The four figures on top of the Notification Center. */
export function noticeCounts(items) {
  return {
    total: items.length,
    unread: items.filter((i) => !i.read).length,
    deadlines: items.filter((i) => DEADLINE_KINDS.includes(i.kind)).length,
    updates: items.filter((i) => !DEADLINE_KINDS.includes(i.kind)).length,
  };
}

// "View details" on a notice opens a small detail window. These work out what it says from the notice itself; nothing more is fetched.
const STATUS = Object.freeze({ OVERDUE: 'Time limit used up', DEADLINE: 'Near its deadline', HIGH_RISK: 'Likely to finish late', MANY_HIGH_RISK: 'Many likely late', VOLUME: 'Busy day', CALENDAR: 'Calendar changed', ACCESS: 'Access request update' });
const COMPLAINT_STATUS = Object.freeze({ ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Where the "Open ..." button of a notice goes: as close to the thing itself as the page allows.
 * A complaint notice opens that complaint (/complaints?open=<id>), a deadline notice opens its transaction, a calendar notice opens the
 * Holidays and suspensions tab. Null when the notice has no link.
 */
export function noticePage(item) {
  const href = item?.href;
  if (!href) return null;
  if (item.kind === 'COMPLAINT') {
    const id = String(item.key ?? '').split(':')[1];
    if (UUID.test(id)) return { href: `/complaints?open=${id}`, label: 'Complaint' };
  }
  if (item.kind === 'CALENDAR') return { href: '/calendar?tab=holidays', label: 'Holidays and suspensions' };
  if (href.startsWith('/transactions/')) return { href, label: 'Transaction' };
  const label = { '/complaints': 'Complaints', '/calendar': 'Calendar', '/access': 'Access', '/late-risk': 'Chance of finishing late', '/transactions': 'Transactions' }[href];
  return { href, label: label ?? 'Page' };
}

/** The rows of the detail window: only the ones this notice has. [{ label, value, mono? }] */
export function noticeDetails(item) {
  const text = String(item?.text ?? '');
  const rows = [{ label: 'Notice', value: kindStyle(item?.kind).label }];
  const status = item?.kind === 'COMPLAINT' ? COMPLAINT_STATUS[String(item.key).split(':').pop()] : STATUS[item?.kind];
  if (status) rows.push({ label: 'Status', value: status });
  const reference = item?.kind === 'COMPLAINT' ? text.match(/^Complaint (\S+)/)?.[1] : DEADLINE_KINDS.includes(item?.kind) ? text.match(/^(\S+) \(/)?.[1] : null;
  if (reference) rows.push({ label: item.kind === 'COMPLAINT' ? 'Complaint reference' : 'Tracking number', value: reference, mono: true });
  const service = DEADLINE_KINDS.includes(item?.kind) ? text.match(/^\S+ \((.+?)\) /)?.[1] : null;
  if (service) rows.push({ label: 'Service', value: service });
  if (item?.kind === 'MANY_HIGH_RISK' && Number.isFinite(item.count)) rows.push({ label: 'Requests likely late', value: String(item.count) });
  const page = noticePage(item);
  if (page) rows.push({ label: 'Where to see it', value: page.label });
  return rows;
}
