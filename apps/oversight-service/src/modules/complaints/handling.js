import { randomUUID } from 'node:crypto';
import { AppError, Errors, ROLES, isUuid } from 'ccms-shared';
import { COMPLAINT_CATEGORIES } from './complaints.js';

// Sprint 7 CC034 / CC035: staff handle the complaints of an office. RECEIVED -> ACKNOWLEDGED -> RESOLVED, forward only; resolving needs a
// written reply. A complaint is due 5 working days after it was filed (Core /deadline, which knows the calendar); after that, if it is not
// resolved, it is overdue. The audit trail carries the reference and the status change, never the citizen's name, email or the reply text.
export const WORKING_DAYS_TO_RESOLVE = 5; // TEAM DEFAULT from the backlog ("due 5 working days from filing")
export const REPLY_MAX = 2000;
export const ACTION_ACKNOWLEDGED = 'COMPLAINT_ACKNOWLEDGED';
export const ACTION_RESOLVED = 'COMPLAINT_RESOLVED';
const STATUSES = ['RECEIVED', 'ACKNOWLEDGED', 'RESOLVED'];
const CATEGORY_LABEL = Object.fromEntries(COMPLAINT_CATEGORIES.map((c) => [c.value, c.label]));
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const lower = (v) => String(v ?? '').toLowerCase();

const COLUMNS = `complaint_id, reference, office_id, category, description, tracking_no, complainant_name, complainant_email, status, created_at, due_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by, reply`;

/** The due time asked of Core with the shared service key. Returns an ISO string, or null when Core cannot say (never a guess). */
export async function coreDeadline({ start, officeId }, { env = process.env, fetchImpl = fetch } = {}) {
  const raw = String(env.CORE_URL ?? env.CORE_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw || !env.SERVICE_KEY) return null;
  try {
    const response = await fetchImpl(`${raw.endsWith('/api') ? raw : `${raw}/api`}/deadline`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-service-key': env.SERVICE_KEY },
      body: JSON.stringify({ start: new Date(start).toISOString(), workingDays: WORKING_DAYS_TO_RESOLVE, officeId, heldMinutes: 0 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const when = new Date(body?.deadline);
    return Number.isNaN(when.getTime()) ? null : when.toISOString();
  } catch {
    return null;
  }
}
let deadlineProvider = null;
/** Tests only. */
export const setDeadlineProvider = (fn) => { deadlineProvider = fn; };
export const computeDue = (args) => (deadlineProvider ?? coreDeadline)(args);

export const isOverdue = (row, now = new Date()) => row.status !== 'RESOLVED' && Boolean(row.due_at) && new Date(row.due_at).getTime() < now.getTime();

/** What a person may see of a complaint. The citizen's name and email only go to the Office Head and Super Admin who reply to it. */
export function complaintDto(row, viewer, now = new Date()) {
  const handler = viewer.role === ROLES.SUPER_ADMIN || viewer.role === ROLES.OFFICE_HEAD;
  const dto = {
    complaint_id: row.complaint_id, reference: row.reference, office_id: row.office_id,
    category: row.category, category_label: CATEGORY_LABEL[row.category] ?? row.category,
    description: row.description, tracking_no: row.tracking_no ?? null,
    status: row.status, created_at: row.created_at, due_at: row.due_at ?? null, overdue: isOverdue(row, now),
    acknowledged_at: row.acknowledged_at ?? null, resolved_at: row.resolved_at ?? null, reply: row.reply ?? null,
  };
  if (handler) { dto.complainant_name = row.complainant_name ?? null; dto.complainant_email = row.complainant_email ?? null; }
  return dto;
}

/** Super Admin and Executive: every office. Office Head and Office Staff: their own office only (a complaint of another office is a 404). */
export function canSee(actor, row) {
  if (actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.EXECUTIVE) return true;
  return (actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF) && lower(row.office_id) === lower(actor.officeId);
}

/** Fills a missing due time (a complaint filed while Core was down). Best effort: still null when Core cannot answer. */
async function ensureDue(db, row) {
  if (row.due_at || row.status === 'RESOLVED') return row;
  const due = await computeDue({ start: row.created_at, officeId: row.office_id });
  if (!due) return row;
  await db.query('UPDATE complaints SET due_at = $2 WHERE complaint_id = $1 AND due_at IS NULL', [row.complaint_id, due]);
  return { ...row, due_at: due };
}

async function load(db, id, { forUpdate = false } = {}) {
  if (!isUuid(id)) throw Errors.notFound('Complaint not found', 'COMPLAINT_NOT_FOUND');
  const [row] = rowsOf(await db.query(`SELECT ${COLUMNS} FROM complaints WHERE complaint_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]));
  if (!row) throw Errors.notFound('Complaint not found', 'COMPLAINT_NOT_FOUND');
  return row;
}

export async function getComplaint(db, actor, id, { now = new Date() } = {}) {
  let row = await load(db, id);
  if (!canSee(actor, row)) throw Errors.notFound('Complaint not found', 'COMPLAINT_NOT_FOUND');
  row = await ensureDue(db, row);
  return complaintDto(row, actor, now);
}

/** GET /complaints?office_id=&status=&overdue=true&page=&page_size= : newest first. */
export async function listComplaints(db, actor, params, { now = new Date() } = {}) {
  const where = [];
  const values = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replaceAll('?', `$${values.length}`)); };
  if (actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF) add('office_id = ?::uuid', actor.officeId);
  const officeId = params.get('office_id');
  const status = params.get('status');
  const overdue = params.get('overdue');
  const details = {};
  if (officeId && !isUuid(officeId)) details.office_id = 'Choose a valid office.';
  if (status && !STATUSES.includes(status)) details.status = 'Choose a valid status.';
  if (overdue && overdue !== 'true') details.overdue = 'Use overdue=true or leave it out.';
  const num = (name, fallback, max) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return fallback;
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > max) { details[name] = `${name} must be a whole number from 1 to ${max}`; return fallback; }
    return n;
  };
  const page = num('page', 1, 1_000_000);
  const pageSize = num('page_size', 20, 100);
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  if (officeId) {
    if ((actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF) && lower(officeId) !== lower(actor.officeId)) throw Errors.forbidden();
    add('office_id = ?::uuid', officeId);
  }
  if (status) add('status = ?', status);
  if (overdue === 'true') { where.push(`status <> 'RESOLVED' AND due_at IS NOT NULL AND due_at < now()`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = rowsOf(await db.query(`SELECT count(*)::int AS total FROM complaints ${clause}`, values));
  let rows = rowsOf(await db.query(`SELECT ${COLUMNS} FROM complaints ${clause} ORDER BY created_at DESC, complaint_id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values));
  rows = await Promise.all(rows.map((row) => ensureDue(db, row)));
  return { items: rows.map((row) => complaintDto(row, actor, now)), total, page, page_size: pageSize };
}

async function writeAudit(manager, actor, row, action, before, after) {
  await manager.query(
    `INSERT INTO audit_log (audit_id, actor_user_id, actor_role, action, entity_type, entity_id, entity_name, office_id, before_value, after_value, occurred_at)
     VALUES ($1, $2, $3, $4, 'complaint', $5, $6, $7, $8::jsonb, $9::jsonb, now())`,
    [randomUUID(), actor.id, actor.role, action, row.complaint_id, row.reference, row.office_id, JSON.stringify(before), JSON.stringify(after)],
  );
}

function assertHandler(actor, row) {
  if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.OFFICE_HEAD) throw Errors.forbidden();
  if (!canSee(actor, row)) throw Errors.notFound('Complaint not found', 'COMPLAINT_NOT_FOUND');
}

/** POST /complaints/:id/acknowledge : RECEIVED -> ACKNOWLEDGED. */
export async function acknowledgeComplaint(db, actor, id, { now = new Date() } = {}) {
  if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.OFFICE_HEAD) throw Errors.forbidden();
  const saved = await db.transaction(async (manager) => {
    const row = await load(manager, id, { forUpdate: true });
    assertHandler(actor, row);
    if (row.status !== 'RECEIVED') throw Errors.conflict(row.status === 'ACKNOWLEDGED' ? 'This complaint has already been acknowledged.' : 'This complaint has already been resolved.', 'COMPLAINT_INVALID_STATE');
    await manager.query(`UPDATE complaints SET status = 'ACKNOWLEDGED', acknowledged_at = $2, acknowledged_by = $3 WHERE complaint_id = $1`, [id, now, actor.id]);
    await writeAudit(manager, actor, row, ACTION_ACKNOWLEDGED, { status: 'RECEIVED' }, { status: 'ACKNOWLEDGED' });
    return { ...row, status: 'ACKNOWLEDGED', acknowledged_at: now, acknowledged_by: actor.id };
  });
  return complaintDto(await ensureDue(db, saved), actor, now);
}

/** POST /complaints/:id/resolve { reply } : ACKNOWLEDGED -> RESOLVED. A written reply is required. */
export async function resolveComplaint(db, actor, id, body, { now = new Date() } = {}) {
  if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.OFFICE_HEAD) throw Errors.forbidden();
  const reply = typeof body?.reply === 'string' ? body.reply.trim() : '';
  if (!reply) throw Errors.validation('Write the reply to resolve this complaint.', { reply: 'Write the reply to resolve this complaint.' });
  if (reply.length > REPLY_MAX) throw Errors.validation(`The reply must be ${REPLY_MAX} characters or fewer.`, { reply: `The reply must be ${REPLY_MAX} characters or fewer.` });
  const saved = await db.transaction(async (manager) => {
    const row = await load(manager, id, { forUpdate: true });
    assertHandler(actor, row);
    if (row.status === 'RESOLVED') throw Errors.conflict('This complaint has already been resolved.', 'COMPLAINT_INVALID_STATE');
    if (row.status !== 'ACKNOWLEDGED') throw Errors.conflict('Acknowledge the complaint before resolving it.', 'COMPLAINT_INVALID_STATE');
    await manager.query(`UPDATE complaints SET status = 'RESOLVED', resolved_at = $2, resolved_by = $3, reply = $4 WHERE complaint_id = $1`, [id, now, actor.id, reply]);
    await writeAudit(manager, actor, row, ACTION_RESOLVED, { status: 'ACKNOWLEDGED' }, { status: 'RESOLVED' }); // the reply text stays out of the audit log
    return { ...row, status: 'RESOLVED', resolved_at: now, resolved_by: actor.id, reply };
  });
  return complaintDto(saved, actor, now);
}

export { AppError };
