import { Errors, ROLES } from 'ccms-shared';
import { requireStaffSwitch } from '../../lib/switches.js';

// Sprint 7 CC055: the Oversight half of the notification bell, worked out each time it is asked for (nothing is stored but the read marks).
//   COMPLAINT  a complaint of the person's office was acknowledged or resolved in the last 7 days (the reference only: never the citizen's name)
//   CALENDAR   a holiday, suspension or closure was added, changed or removed (from the audit trail) in the last 7 days, for the person's office or the whole campus
// Deadline, overdue and High late-risk notices come from Operations (GET /api/operations/notifications); the screen joins the two.
// Read marks are per user and kept 30 days. No email is ever sent. The Executive has no bell.
export const WINDOW_DAYS = 7;
export const KEEP_READ_DAYS = 30;
export const MAX_PER_KIND = 50;
export const KEY_PATTERN = /^[a-z_]+:[0-9A-Za-z:_.-]{1,150}$/;
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const bound = (actor) => actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF;
const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const word = (v) => String(v ?? '').toLowerCase().replaceAll('_', ' ');

const CALENDAR_VERB = { CALENDAR_EXCEPTION_ADDED: 'added', CALENDAR_EXCEPTION_UPDATED: 'changed', CALENDAR_EXCEPTION_REMOVED: 'removed' };

export async function listNotifications(db, actor, { now = new Date() } = {}) {
  if (actor.role === ROLES.EXECUTIVE) throw Errors.forbidden();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const office = bound(actor) ? actor.officeId : null;
  const items = [];

  let complaintsVisible = true;
  if (actor.role === ROLES.OFFICE_STAFF) { try { await requireStaffSwitch(actor, 'STAFF_VIEW_COMPLAINTS'); } catch { complaintsVisible = false; } }
  if (complaintsVisible) {
    const rows = rowsOf(await db.query(
      `SELECT complaint_id, reference, office_id, status, acknowledged_at, resolved_at FROM complaints
        WHERE ($1::uuid IS NULL OR office_id = $1::uuid) AND (acknowledged_at >= $2 OR resolved_at >= $2)
        ORDER BY GREATEST(acknowledged_at, resolved_at) DESC LIMIT ${MAX_PER_KIND}`, [office, since]));
    for (const row of rows) {
      if (row.acknowledged_at && new Date(row.acknowledged_at) >= since) {
        items.push({ key: `complaint:${row.complaint_id}:ACKNOWLEDGED`, kind: 'COMPLAINT', text: `Complaint ${row.reference} was acknowledged.`, at: iso(row.acknowledged_at), office_id: row.office_id, href: '/complaints' });
      }
      if (row.resolved_at && new Date(row.resolved_at) >= since) {
        items.push({ key: `complaint:${row.complaint_id}:RESOLVED`, kind: 'COMPLAINT', text: `Complaint ${row.reference} was resolved.`, at: iso(row.resolved_at), office_id: row.office_id, href: '/complaints' });
      }
    }
  }

  const events = rowsOf(await db.query(
    `SELECT audit_id, action, office_id, before_value, after_value, occurred_at FROM audit_log
      WHERE entity_type = 'calendar_exception' AND occurred_at >= $2 AND ($1::uuid IS NULL OR office_id IS NULL OR office_id = $1::uuid)
      ORDER BY occurred_at DESC LIMIT ${MAX_PER_KIND}`, [office, since]));
  for (const row of events) {
    const entry = row.after_value ?? row.before_value ?? {};
    const date = entry.exception_date ?? entry.date ?? null;
    items.push({ key: `calendar:${row.audit_id}`, kind: 'CALENDAR', text: `Calendar: ${word(entry.exception_type) || 'an entry'} ${CALENDAR_VERB[row.action] ?? 'changed'}${date ? ` for ${date}` : ''}${row.office_id ? '' : ' (whole campus)'}.`, at: iso(row.occurred_at), office_id: row.office_id ?? null, href: '/calendar' });
  }

  items.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const read = rowsOf(await db.query(
    `SELECT notification_key FROM notification_reads WHERE user_id = $1 AND read_at >= $2 ORDER BY read_at DESC LIMIT 2000`,
    [actor.id, new Date(now.getTime() - KEEP_READ_DAYS * 86_400_000)])).map((r) => r.notification_key);
  const readSet = new Set(read);
  return { items: items.map((i) => ({ ...i, read: readSet.has(i.key) })), read_keys: read, generated_at: iso(now) };
}

/** POST /notifications/read { keys: [...] } : marks the keys as read for this user. Old marks (over 30 days) are removed. */
export async function markNotificationsRead(db, actor, body, { now = new Date() } = {}) {
  if (actor.role === ROLES.EXECUTIVE) throw Errors.forbidden();
  const keys = body?.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 200 || !keys.every((k) => typeof k === 'string' && k.length <= 200 && KEY_PATTERN.test(k))) {
    throw Errors.validation('Send between 1 and 200 notification keys.', { keys: 'Send between 1 and 200 notification keys.' });
  }
  const unique = [...new Set(keys)];
  await db.query(
    `INSERT INTO notification_reads (user_id, notification_key, read_at) SELECT $1, k, $3 FROM unnest($2::text[]) AS k ON CONFLICT DO NOTHING`,
    [actor.id, unique, now]);
  await db.query('DELETE FROM notification_reads WHERE user_id = $1 AND read_at < $2', [actor.id, new Date(now.getTime() - KEEP_READ_DAYS * 86_400_000)]);
  return { marked: unique.length };
}
