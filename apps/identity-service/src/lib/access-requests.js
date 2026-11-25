import { Errors, ROLES, GRANTABLE, REQUESTER_ROLES, isGrantable, recordAudit, resolveEndsOn, toManilaDate, isUuid } from 'ccms-shared';
import { randomUUID } from 'node:crypto';
import { kickOutbox } from './outbox.js';

// S8-52 / D-AC-4: request access, grant with an end date, deny, revoke, expire. Every step is audited. Nobody decides their own request.
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
export const REASON_MAX = 500;
export const SYSTEM = Object.freeze({ actorUserId: null, actorRole: 'system' });
export const MSG = Object.freeze({
  NOT_ALLOWED: 'This access cannot be requested.',
  REASON: 'Write why you need this access.',
  SELF: 'You cannot decide your own request. Another Super Admin must decide it.',
  NOT_PENDING: 'This request was already decided.',
  ALREADY: 'You already have this access, or have asked for it and are waiting.',
  NOT_ACTIVE: 'This access has already ended.',
});

const dto = (r) => ({
  request_id: r.request_id, account_id: r.account_id, account_name: r.account_name ?? null, office_id: r.office_id,
  permission_key: r.permission_key, permission_label: GRANTABLE[r.permission_key]?.label ?? r.permission_key, reason: r.reason, status: r.status,
  requested_at: r.requested_at, decided_at: r.decided_at ?? null, decision_note: r.decision_note ?? null, ends_on: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
});

export function parseRequest(body, actor) {
  if (!REQUESTER_ROLES.includes(actor.role)) throw Errors.forbidden(MSG.NOT_ALLOWED);
  const key = body?.permission_key;
  if (!isGrantable(key)) throw Errors.validation(MSG.NOT_ALLOWED, { permission_key: MSG.NOT_ALLOWED });
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw Errors.validation(MSG.REASON, { reason: MSG.REASON });
  if (reason.length > REASON_MAX) throw Errors.validation(`Keep the reason within ${REASON_MAX} characters.`, { reason: `Keep the reason within ${REASON_MAX} characters.` });
  return { key, reason };
}

/** Decides what a decision body means: { decision: 'GRANT' | 'DENY', ends_on?, note? }. Pure, so it is tested without a database. */
export function parseDecision(body, { requesterId, actor, today }) {
  if (actor.role !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  if (String(requesterId).toLowerCase() === String(actor.id).toLowerCase()) throw Errors.forbidden(MSG.SELF, 'SELF_DECISION');
  const decision = body?.decision;
  if (decision !== 'GRANT' && decision !== 'DENY') throw Errors.validation('Choose Grant or Deny.', { decision: 'Choose Grant or Deny.' });
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, REASON_MAX) || null : null;
  return { decision, note, endsOn: decision === 'GRANT' ? resolveEndsOn(body?.ends_on, today) : null };
}

export async function expireDueGrants(db, { now = new Date() } = {}) {
  const today = toManilaDate(now);
  const due = rowsOf(await db.query(`SELECT grant_id, request_id, account_id, office_id, permission_key, ends_on FROM account_permission_grants WHERE status = 'ACTIVE' AND ends_on < $1::date`, [today]));
  for (const g of due) {
    await db.transaction(async (manager) => {
      const done = rowsOf(await manager.query(`UPDATE account_permission_grants SET status = 'EXPIRED', ended_at = $2 WHERE grant_id = $1 AND status = 'ACTIVE' RETURNING grant_id`, [g.grant_id, now]));
      if (!done.length) return;
      await manager.query(`UPDATE access_requests SET status = 'EXPIRED' WHERE request_id = $1 AND status = 'GRANTED'`, [g.request_id]);
      await recordAudit(manager, { actor: SYSTEM, action: 'ACCESS_EXPIRED', entityType: 'access_request', entityId: g.request_id, officeId: g.office_id,
        before: { status: 'GRANTED' }, after: { status: 'EXPIRED', account_id: g.account_id, permission_key: g.permission_key, ends_on: String(g.ends_on).slice(0, 10) } });
    });
  }
  if (due.length) kickOutbox();
  return due.length;
}

export async function createRequest(db, actor, body, { ipAddress, now = new Date() } = {}) {
  const { key, reason } = parseRequest(body, actor);
  await expireDueGrants(db, { now });
  const id = randomUUID();
  await db.transaction(async (manager) => {
    const clash = rowsOf(await manager.query(
      `SELECT 1 FROM access_requests WHERE account_id = $1 AND permission_key = $2 AND status = 'PENDING'
       UNION ALL SELECT 1 FROM account_permission_grants WHERE account_id = $1 AND permission_key = $2 AND status = 'ACTIVE'`, [actor.id, key]));
    if (clash.length) throw Errors.conflict(MSG.ALREADY, 'ACCESS_ALREADY');
    await manager.query(`INSERT INTO access_requests (request_id, account_id, office_id, permission_key, reason, status, requested_at) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)`,
      [id, actor.id, actor.officeId, key, reason, now]);
    await recordAudit(manager, { actor, action: 'ACCESS_REQUESTED', entityType: 'access_request', entityId: id, officeId: actor.officeId, before: null,
      after: { status: 'PENDING', account_id: actor.id, permission_key: key, reason }, ipAddress });
  });
  kickOutbox();
  return getRequest(db, id);
}

async function getRequest(db, id) {
  const [row] = rowsOf(await db.query(`SELECT r.*, a.full_name AS account_name FROM access_requests r JOIN accounts a ON a.account_id = r.account_id WHERE r.request_id = $1`, [id]));
  return row ? dto(row) : null;
}

/** Super Admin: every request (optionally one status). Everyone else: only their own. */
export async function listRequests(db, actor, params, { now = new Date() } = {}) {
  await expireDueGrants(db, { now });
  const status = params?.get?.('status') ?? null;
  if (status && !['PENDING', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED'].includes(status)) throw Errors.validation('Choose a valid status.', { status: 'Choose a valid status.' });
  const own = actor.role !== ROLES.SUPER_ADMIN;
  if (own && !REQUESTER_ROLES.includes(actor.role)) throw Errors.forbidden();
  const rows = rowsOf(await db.query(
    `SELECT r.*, a.full_name AS account_name FROM access_requests r JOIN accounts a ON a.account_id = r.account_id
      WHERE ($1::uuid IS NULL OR r.account_id = $1::uuid) AND ($2::text IS NULL OR r.status = $2::text)
      ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 200`, [own ? actor.id : null, status]));
  return { items: rows.map(dto) };
}

export async function decideRequest(db, actor, requestId, body, { ipAddress, now = new Date() } = {}) {
  if (!isUuid(requestId)) throw Errors.notFound('Request not found.');
  const today = toManilaDate(now);
  await db.transaction(async (manager) => {
    const [request] = rowsOf(await manager.query('SELECT * FROM access_requests WHERE request_id = $1 FOR UPDATE', [requestId]));
    if (!request) throw Errors.notFound('Request not found.');
    const { decision, note, endsOn } = parseDecision(body, { requesterId: request.account_id, actor, today });
    if (request.status !== 'PENDING') throw Errors.conflict(MSG.NOT_PENDING, 'REQUEST_NOT_PENDING');
    if (decision === 'DENY') {
      await manager.query(`UPDATE access_requests SET status = 'DENIED', decided_by = $2, decided_at = $3, decision_note = $4 WHERE request_id = $1`, [requestId, actor.id, now, note]);
      await recordAudit(manager, { actor, action: 'ACCESS_DENIED', entityType: 'access_request', entityId: requestId, officeId: request.office_id,
        before: { status: 'PENDING' }, after: { status: 'DENIED', account_id: request.account_id, permission_key: request.permission_key }, ipAddress });
      return;
    }
    // The grant stays in the requester's own office: that office was fixed when the request was made.
    await manager.query(`UPDATE access_requests SET status = 'GRANTED', decided_by = $2, decided_at = $3, decision_note = $4, ends_on = $5 WHERE request_id = $1`, [requestId, actor.id, now, note, endsOn]);
    await manager.query(`INSERT INTO account_permission_grants (grant_id, request_id, account_id, office_id, permission_key, granted_by, granted_at, ends_on, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')`, [randomUUID(), requestId, request.account_id, request.office_id, request.permission_key, actor.id, now, endsOn]);
    await recordAudit(manager, { actor, action: 'ACCESS_GRANTED', entityType: 'access_request', entityId: requestId, officeId: request.office_id,
      before: { status: 'PENDING' }, after: { status: 'GRANTED', account_id: request.account_id, permission_key: request.permission_key, ends_on: endsOn }, ipAddress });
  });
  kickOutbox();
  return getRequest(db, requestId);
}

/** Super Admin: the grants that work right now (who, what, why, until when). */
export async function listActiveGrants(db, actor, { now = new Date() } = {}) {
  if (actor.role !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  await expireDueGrants(db, { now });
  const rows = rowsOf(await db.query(
    `SELECT g.grant_id, g.account_id, g.office_id, g.permission_key, g.ends_on, g.granted_at, a.full_name AS account_name, r.reason
       FROM account_permission_grants g JOIN accounts a ON a.account_id = g.account_id JOIN access_requests r ON r.request_id = g.request_id
      WHERE g.status = 'ACTIVE' ORDER BY g.ends_on ASC, a.full_name ASC LIMIT 500`));
  const today = toManilaDate(now);
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return { items: rows.map((g) => ({
    grant_id: g.grant_id, account_id: g.account_id, account_name: g.account_name, office_id: g.office_id, permission_key: g.permission_key,
    permission_label: GRANTABLE[g.permission_key]?.label ?? g.permission_key, reason: g.reason, ends_on: String(g.ends_on).slice(0, 10), granted_at: g.granted_at,
    ends_soon: String(g.ends_on).slice(0, 10) <= soon,
  })) };
}

export async function revokeGrant(db, actor, grantId, { ipAddress, now = new Date() } = {}) {
  if (actor.role !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  if (!isUuid(grantId)) throw Errors.notFound('Access not found.');
  await db.transaction(async (manager) => {
    const [g] = rowsOf(await manager.query('SELECT * FROM account_permission_grants WHERE grant_id = $1 FOR UPDATE', [grantId]));
    if (!g) throw Errors.notFound('Access not found.');
    if (g.status !== 'ACTIVE') throw Errors.conflict(MSG.NOT_ACTIVE, 'GRANT_NOT_ACTIVE');
    await manager.query(`UPDATE account_permission_grants SET status = 'REVOKED', ended_at = $2, ended_by = $3 WHERE grant_id = $1`, [grantId, now, actor.id]);
    await manager.query(`UPDATE access_requests SET status = 'REVOKED' WHERE request_id = $1`, [g.request_id]);
    await recordAudit(manager, { actor, action: 'ACCESS_REVOKED', entityType: 'access_request', entityId: g.request_id, officeId: g.office_id,
      before: { status: 'GRANTED' }, after: { status: 'REVOKED', account_id: g.account_id, permission_key: g.permission_key }, ipAddress });
  });
  kickOutbox();
  return { revoked: true };
}

/** For the other services: the grants that work right now for one account (office included, so a grant never crosses offices). */
export async function activeGrantsFor(db, accountId, { now = new Date() } = {}) {
  if (!isUuid(accountId)) throw Errors.validation('Send a valid account id.', { account_id: 'Send a valid account id.' });
  await expireDueGrants(db, { now });
  const rows = rowsOf(await db.query(`SELECT permission_key, office_id, ends_on FROM account_permission_grants WHERE account_id = $1 AND status = 'ACTIVE' AND ends_on >= $2::date`, [accountId, toManilaDate(now)]));
  return { grants: rows.map((g) => ({ permission_key: g.permission_key, office_id: g.office_id, ends_on: String(g.ends_on).slice(0, 10) })) };
}
