import { Errors, GRANTABLE, ROLES } from 'ccms-shared';
import { requireStaffSwitch } from '../../lib/switches.js';
import { readVolumeNotices } from './volume.js';

// Sprint 7 CC055: the Oversight half of the notification bell, worked out each time it is asked for (nothing is stored but the read marks).
//   COMPLAINT  a complaint of the person's office was acknowledged or resolved in the last 7 days (the reference only: never the citizen's name)
//   CALENDAR   a holiday, suspension or closure was added, changed or removed (from the audit trail) in the last 7 days, for the person's office or the whole campus
// Deadline, overdue and High late-risk notices come from Operations (GET /api/operations/notifications); the screen joins the two.
// Read marks are per user and kept 30 days. No email is ever sent. The Executive has no bell.
export const WINDOW_DAYS = 7;
export const KEEP_READ_DAYS = 30;
export const MAX_PER_KIND = 50;
export const DELETED_PREFIX = 'deleted:';
export const KEY_PATTERN = /^[a-z_]+:[0-9A-Za-z:_.-]{1,150}$/;
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const bound = (actor) => actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF;
const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const word = (v) => String(v ?? '').toLowerCase().replaceAll('_', ' ');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'December 24, 2026' from a YYYY-MM-DD date. */
export const writtenDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : '');
export const ACCESS_TEXT = Object.freeze({
  ACCESS_GRANTED: (what, v) => `Your request for \u201c${what}\u201d was approved${v?.ends_on ? ` until ${writtenDate(v.ends_on)}` : ''}.`,
  ACCESS_DENIED: (what) => `Your request for \u201c${what}\u201d was not approved.`,
  ACCESS_REVOKED: (what) => `Your access to \u201c${what}\u201d was removed by the Super Admin.`,
  ACCESS_EXPIRED: (what) => `Your access to \u201c${what}\u201d has ended.`,
});

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

  // S8-50 (b): only the Office Head (own office) and the Super Admin hear about an unusually busy day.
  if (actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.SUPER_ADMIN) items.push(...(await readVolumeNotices(db, { officeId: office, now })));

  // S8-52: what happened to this person's access requests (granted, not approved, removed, ended), from the audit trail. Only to the person.
  if (actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF) {
    const access = rowsOf(await db.query(
      `SELECT audit_id, action, after_value, occurred_at FROM audit_log
        WHERE entity_type = 'access_request' AND action = ANY($3::text[]) AND occurred_at >= $2 AND after_value->>'account_id' = $1::text
        ORDER BY occurred_at DESC LIMIT ${MAX_PER_KIND}`, [actor.id, since, Object.keys(ACCESS_TEXT)]));
    for (const row of access) {
      const what = GRANTABLE[row.after_value?.permission_key]?.label ?? 'an extra permission';
      items.push({ key: `access:${row.audit_id}`, kind: 'ACCESS', text: ACCESS_TEXT[row.action](what, row.after_value), at: iso(row.occurred_at), office_id: actor.officeId ?? null, href: '/access' });
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const marks = rowsOf(await db.query(
    `SELECT notification_key FROM notification_reads WHERE user_id = $1 AND read_at >= $2 ORDER BY read_at DESC LIMIT 2000`,
    [actor.id, new Date(now.getTime() - KEEP_READ_DAYS * 86_400_000)])).map((r) => r.notification_key);
  // A deleted notice is kept as a mark "deleted:<key>" in the same table (no new table); it never shows again for this user.
  const read = marks.filter((k) => !k.startsWith(DELETED_PREFIX));
  const deleted = marks.filter((k) => k.startsWith(DELETED_PREFIX)).map((k) => k.slice(DELETED_PREFIX.length));
  const readSet = new Set(read);
  const deletedSet = new Set(deleted);
  return { items: items.filter((i) => !deletedSet.has(i.key)).map((i) => ({ ...i, read: readSet.has(i.key) })), read_keys: read, deleted_keys: deleted, generated_at: iso(now) };
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

/** POST /notifications/delete { keys: [...] } : this user no longer sees these notices (they are also read). Kept as "deleted:<key>" marks for 30 days. */
export async function deleteNotifications(db, actor, body, { now = new Date() } = {}) {
  if (actor.role === ROLES.EXECUTIVE) throw Errors.forbidden();
  const keys = body?.keys;
  const max = 200 - DELETED_PREFIX.length; // the stored key must fit the column
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 200 || !keys.every((k) => typeof k === 'string' && k.length <= max && KEY_PATTERN.test(k) && !k.startsWith(DELETED_PREFIX))) {
    throw Errors.validation('Send between 1 and 200 notification keys.', { keys: 'Send between 1 and 200 notification keys.' });
  }
  const unique = [...new Set(keys)];
  await db.query(
    `INSERT INTO notification_reads (user_id, notification_key, read_at) SELECT $1, $4 || k, $3 FROM unnest($2::text[]) AS k ON CONFLICT DO NOTHING`,
    [actor.id, unique, now, DELETED_PREFIX]);
  await db.query('DELETE FROM notification_reads WHERE user_id = $1 AND read_at < $2', [actor.id, new Date(now.getTime() - KEEP_READ_DAYS * 86_400_000)]);
  return { deleted: unique.length };
}
