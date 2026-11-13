import { randomUUID } from 'node:crypto';
import { Errors, ROLES, assertOfficeAccess, isOfficeBound, isUuid, toManilaDate } from 'ccms-shared';
import { CoreRejectedError, CoreUnavailableError } from '../transaction/core-client.js';
import { rowsOf } from '../transaction/db.js';

// =================================================================================================================
// CC039 (spec 9.1; K7, K29): the minimum queue. ONE module for both ways of taking a ticket (the public "Take a ticket"
// page and staff issuance), Call next, Skip, the staff queue panel and the read CC059 ("Now serving") builds on.
//
// Numbering   per office (office_id is the sequence scope) and per Manila calendar date of the server's clock, from 001
//             each day: <office_code>-<seq padded to 3> (for example REG-014; past 999 the number simply grows).
//             The number comes from one atomic upsert of queue_sequences in the same database transaction as the ticket
//             insert; UNIQUE (office_id, queue_date, seq) backs it in the database.
// Lanes       PRIORITY for senior citizens, persons with disability and pregnant women (RA 9994, RA 10754); REGULAR for
//             everyone else. Only the lane is stored: the group the person named is checked and then dropped.
// Call order  every WAITING PRIORITY ticket before any WAITING REGULAR ticket; inside a lane, queue_order ascending (first
//             come, first served). callOrderSql / sortForCalling are the one definition of that order.
// Call next   one UPDATE whose target is chosen by a FOR UPDATE SKIP LOCKED subquery: two staff calling at the same moment
//             always get two different tickets, and a ticket is never claimed twice.
// Skip        K29 no-show: allowed once QUEUE_SKIP_GRACE_MS (3 minutes, TEAM DEFAULT) have passed since the recorded call
//             (called_at). The SAME ticket goes back to WAITING at the tail of its lane: same number, same issued_at, same
//             lane, a new queue_order. A later Call next records a fresh called_at. Stale, repeated or late (served) skips
//             are refused under the ticket's row lock.
// Old days    a ticket belongs to its Manila date only. The queue and every action look at today's tickets; yesterday's
//             leftovers are never called, skipped or linked (they stay as records).
// =================================================================================================================

export const QUEUE_SKIP_GRACE_MS = 3 * 60 * 1000;
export const LANES = Object.freeze({ REGULAR: 'REGULAR', PRIORITY: 'PRIORITY' });
export const PRIORITY_GROUPS = Object.freeze(['SENIOR_CITIZEN', 'PWD', 'PREGNANT']);
export const QUEUE_STATUS = Object.freeze({ WAITING: 'WAITING', CALLED: 'CALLED', SERVED: 'SERVED' });
export const QUEUE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

const ISSUE_FIELDS = new Set(['office_id', 'priority_group']);
const OFFICE_UNAVAILABLE = 'Tickets cannot be issued right now. Please try again in a few minutes.';
const OFFICE_NOT_ELIGIBLE = 'Choose an office from the list.';

/** The display number of a ticket. */
export function ticketNumber(officeCode, seq) {
  return `${officeCode}-${String(seq).padStart(3, '0')}`;
}

/** SQL ORDER BY of the call order (priority lane first, then arrival order inside the lane). */
export const callOrderSql = (alias = '') => `(${alias}lane = 'PRIORITY') DESC, ${alias}queue_order ASC`;

/** The same order in JavaScript, for rows already read. */
export function sortForCalling(tickets) {
  return [...tickets].sort((a, b) => (a.lane === b.lane ? Number(a.queue_order) - Number(b.queue_order) : a.lane === LANES.PRIORITY ? -1 : 1));
}

/**
 * The body of both issuance routes: { office_id, priority_group? }. Nothing else is accepted, so no personal detail can
 * ride along. priority_group is SENIOR_CITIZEN, PWD or PREGNANT (any of them = the priority lane) or absent/null/''.
 * `officeRequired` is false for staff issuance (their own office is the default).
 */
export function parseIssueInput(body, { officeRequired = true } = {}) {
  const details = {};
  for (const key of Object.keys(body ?? {})) if (!ISSUE_FIELDS.has(key)) details[key] = 'This field is not accepted';
  let officeId = null;
  if (body?.office_id !== undefined && body.office_id !== null && body.office_id !== '') {
    if (typeof body.office_id === 'string' && isUuid(body.office_id.trim())) officeId = body.office_id.trim().toLowerCase();
    else details.office_id = OFFICE_NOT_ELIGIBLE;
  } else if (officeRequired) details.office_id = OFFICE_NOT_ELIGIBLE;
  const group = body?.priority_group;
  let lane = LANES.REGULAR;
  if (group !== undefined && group !== null && group !== '') {
    if (PRIORITY_GROUPS.includes(group)) lane = LANES.PRIORITY;
    else details.priority_group = 'Choose senior citizen, person with disability, pregnant, or none';
  }
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  return { officeId, lane };
}

/** An office that may issue tickets: it exists in Core and is active. Core down = 503, never a guess. */
export async function resolveEligibleOffice(core, officeId) {
  let office;
  try {
    office = await core.office(officeId);
  } catch (err) {
    if (err instanceof CoreRejectedError && (err.status === 404 || err.status === 400)) {
      throw Errors.validation(OFFICE_NOT_ELIGIBLE, { office_id: OFFICE_NOT_ELIGIBLE });
    }
    if (err instanceof CoreUnavailableError || err instanceof CoreRejectedError) throw Errors.unavailable(OFFICE_UNAVAILABLE, 'QUEUE_UNAVAILABLE');
    throw err;
  }
  if (!office?.is_active || String(office.office_id).toLowerCase() !== officeId || typeof office.office_code !== 'string' || !office.office_code) {
    throw Errors.validation(OFFICE_NOT_ELIGIBLE, { office_id: OFFICE_NOT_ELIGIBLE });
  }
  return { officeId, officeCode: office.office_code, officeName: typeof office.office_name === 'string' ? office.office_name : null };
}

/** The office a staff action is for: Office Head / Staff their own (anything else is 403); Super Admin must name one. */
export function queueOfficeFor(actor, requested) {
  const officeId = requested ?? (isOfficeBound(actor.role) ? actor.officeId : null);
  if (!officeId || !isUuid(String(officeId))) throw Errors.validation('Choose an office.', { office_id: 'Choose an office.' });
  assertOfficeAccess(actor, String(officeId).toLowerCase());
  return String(officeId).toLowerCase();
}

function issuedDto(row, officeName, waitingAhead) {
  return {
    ticket_no: row.ticket_no,
    office_code: row.office_code,
    office_name: officeName,
    lane: row.lane,
    queue_date: row.queue_date,
    issued_at: new Date(row.issued_at).toISOString(),
    waiting_ahead: waitingAhead,
  };
}

/** A staff view of one ticket (never a name or any personal detail: the queue holds none). */
export function staffTicketDto(row, nowMs) {
  const calledAt = row.called_at ? new Date(row.called_at) : null;
  const skippableAt = row.status === QUEUE_STATUS.CALLED && calledAt ? new Date(calledAt.getTime() + QUEUE_SKIP_GRACE_MS) : null;
  return {
    ticket_id: row.ticket_id,
    ticket_no: row.ticket_no,
    office_id: row.office_id,
    lane: row.lane,
    status: row.status,
    queue_date: row.queue_date,
    issued_at: new Date(row.issued_at).toISOString(),
    issued_via: row.issued_via,
    called_at: calledAt ? calledAt.toISOString() : null,
    call_count: Number(row.call_count),
    skip_count: Number(row.skip_count),
    skippable_at: skippableAt ? skippableAt.toISOString() : null,
    can_skip: skippableAt ? nowMs >= skippableAt.getTime() : false,
    version: Number(row.version),
  };
}

const TICKET_COLUMNS = `ticket_id, office_id, office_code, to_char(queue_date, 'YYYY-MM-DD') AS queue_date, seq, ticket_no, lane, status,
  queue_order, issued_at, issued_via, called_at, call_count, skip_count, served_at, transaction_id, version`;

/**
 * Issues one ticket of `officeId` for today's Manila date. The same code path for the public page (actor null) and staff
 * issuance (actor = the staff account, whose office scope the caller has already checked).
 */
export async function issueTicket(dataSource, { core, now = () => new Date() }, { officeId, lane, actor = null }) {
  const office = await resolveEligibleOffice(core, officeId);
  const issuedAt = now();
  const queueDate = toManilaDate(issuedAt);
  const ticketId = randomUUID();
  const { row, waitingAhead } = await dataSource.transaction(async (manager) => {
    const [{ last_seq: seq, last_order: order }] = rowsOf(
      await manager.query(
        `INSERT INTO queue_sequences (office_id, queue_date, last_seq, last_order) VALUES ($1, $2, 1, 1)
         ON CONFLICT (office_id, queue_date) DO UPDATE
           SET last_seq = queue_sequences.last_seq + 1, last_order = queue_sequences.last_order + 1
         RETURNING last_seq, last_order`,
        [office.officeId, queueDate],
      ),
    );
    const inserted = rowsOf(
      await manager.query(
        `INSERT INTO queue_tickets (ticket_id, office_id, office_code, queue_date, seq, ticket_no, lane, status, queue_order, issued_at, issued_via, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING', $8, $9, $10, $11)
         RETURNING ${TICKET_COLUMNS}`,
        [ticketId, office.officeId, office.officeCode, queueDate, seq, ticketNumber(office.officeCode, seq), lane, order, issuedAt,
          actor ? 'STAFF' : 'PUBLIC', actor ? actor.id : null],
      ),
    )[0];
    // How many will be called before this ticket, by the call order, as the queue stands now.
    const [{ ahead }] = await manager.query(
      `SELECT count(*)::int AS ahead FROM queue_tickets
        WHERE office_id = $1 AND queue_date = $2 AND status = 'WAITING' AND ticket_id <> $3
          AND ((lane = 'PRIORITY' AND $4::text = 'REGULAR') OR (lane = $4::text AND queue_order < $5))`,
      [office.officeId, queueDate, ticketId, lane, order],
    );
    return { row: inserted, waitingAhead: ahead };
  });
  return issuedDto(row, office.officeName, waitingAhead);
}

/** Staff issuance: the same issueTicket, for the caller's authorised office. */
export async function issueTicketAsStaff(dataSource, deps, actor, body) {
  const input = parseIssueInput(body, { officeRequired: false });
  const officeId = queueOfficeFor(actor, input.officeId);
  return issueTicket(dataSource, deps, { officeId, lane: input.lane, actor });
}

/**
 * Call next: the first WAITING ticket of today by the call order becomes CALLED with a fresh called_at. Atomic: the target
 * is locked with SKIP LOCKED, so competing calls take different tickets. An empty queue is a normal answer.
 */
export async function callNextTicket(dataSource, { now = () => new Date() }, actor, body = {}) {
  const officeId = queueOfficeFor(actor, body.office_id ?? null);
  const calledAt = now();
  const queueDate = toManilaDate(calledAt);
  const rows = rowsOf(
    await dataSource.query(
      `UPDATE queue_tickets t
          SET status = 'CALLED', called_at = $3, called_by = $4, call_count = t.call_count + 1, version = t.version + 1
        WHERE t.ticket_id = (
                SELECT ticket_id FROM queue_tickets
                 WHERE office_id = $1 AND queue_date = $2 AND status = 'WAITING'
                 ORDER BY ${callOrderSql()}
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED)
          AND t.status = 'WAITING'
      RETURNING ${TICKET_COLUMNS}`,
      [officeId, queueDate, calledAt, actor.id],
    ),
  );
  const ticket = rows[0] ? staffTicketDto(rows[0], calledAt.getTime()) : null;
  return { office_id: officeId, queue_date: queueDate, queue_empty: ticket === null, ticket, message: ticket ? null : 'No one is waiting in the queue.' };
}

/** The optional `version` of a Skip body: the version the panel last saw (a different one = the ticket changed since). */
function parseSkipBody(body) {
  if (body?.version === undefined || body.version === null) return { version: null };
  if (!Number.isInteger(body.version) || body.version < 1) throw Errors.validation('Please correct the highlighted fields', { version: 'Must be a whole number' });
  return { version: body.version };
}

/**
 * Skip a called ticket that did not come to the counter (K29). Under the ticket's row lock:
 *   not found / other office          404 / 403
 *   not today's ticket                 409 TICKET_EXPIRED
 *   not CALLED (repeated skip, or it was linked at Start in the meantime)   409 TICKET_NOT_CALLED
 *   version given and different        409 TICKET_CHANGED (the panel is stale: it was skipped and called again since)
 *   less than 3:00 since called_at     409 SKIP_TOO_EARLY with details.skippable_at
 * Otherwise the ticket is WAITING again at the tail of its lane (a new queue_order from the office/day counter), keeping
 * its number, issued_at and lane. called_at is cleared; the next call records a new one.
 */
export async function skipTicket(dataSource, { now = () => new Date() }, actor, ticketId, body = {}) {
  if (!isUuid(ticketId)) throw Errors.notFound('Ticket not found', 'TICKET_NOT_FOUND');
  const { version } = parseSkipBody(body);
  const at = now();
  return dataSource.transaction(async (manager) => {
    const [ticket] = await manager.query(`SELECT ${TICKET_COLUMNS} FROM queue_tickets WHERE ticket_id = $1 FOR UPDATE`, [ticketId]);
    if (!ticket) throw Errors.notFound('Ticket not found', 'TICKET_NOT_FOUND');
    assertOfficeAccess(actor, ticket.office_id);
    if (ticket.queue_date !== toManilaDate(at)) throw Errors.conflict('This ticket is from an earlier day.', 'TICKET_EXPIRED');
    if (ticket.status !== QUEUE_STATUS.CALLED) throw Errors.conflict('This ticket is not being called any more.', 'TICKET_NOT_CALLED');
    if (version !== null && version !== Number(ticket.version)) throw Errors.conflict('This ticket changed since you looked. Refresh the queue.', 'TICKET_CHANGED');
    const skippableAt = new Date(new Date(ticket.called_at).getTime() + QUEUE_SKIP_GRACE_MS);
    if (at.getTime() < skippableAt.getTime()) {
      throw Errors.conflict('Skip is available 3 minutes after the ticket was called.', 'SKIP_TOO_EARLY', { skippable_at: skippableAt.toISOString() });
    }
    const [{ last_order: order }] = rowsOf(
      await manager.query(
        'UPDATE queue_sequences SET last_order = last_order + 1 WHERE office_id = $1 AND queue_date = $2 RETURNING last_order',
        [ticket.office_id, ticket.queue_date],
      ),
    );
    const [updated] = rowsOf(
      await manager.query(
        `UPDATE queue_tickets SET status = 'WAITING', queue_order = $2, called_at = NULL, called_by = NULL, skip_count = skip_count + 1,
                last_skipped_at = $3, version = version + 1
          WHERE ticket_id = $1 RETURNING ${TICKET_COLUMNS}`,
        [ticketId, order, at],
      ),
    );
    return { ticket: staffTicketDto(updated, at.getTime()) };
  });
}

/** Today's tickets of one office that are not served yet, in call order (WAITING) plus the CALLED ones, newest call first. */
export async function readOpenTickets(manager, officeId, queueDate) {
  const rows = await manager.query(
    `SELECT ${TICKET_COLUMNS} FROM queue_tickets WHERE office_id = $1 AND queue_date = $2 AND status IN ('WAITING', 'CALLED')`,
    [officeId, queueDate],
  );
  const called = rows.filter((r) => r.status === QUEUE_STATUS.CALLED).sort((a, b) => new Date(b.called_at) - new Date(a.called_at) || b.seq - a.seq);
  const waiting = sortForCalling(rows.filter((r) => r.status === QUEUE_STATUS.WAITING));
  return { called, waiting };
}

/** The staff queue panel (and the CC040 ticket picker): called tickets, then the waiting line in call order. */
export async function getQueueBoard(dataSource, { now = () => new Date() }, actor, params) {
  const officeId = queueOfficeFor(actor, params?.get?.('office_id') || null);
  const at = now();
  const queueDate = toManilaDate(at);
  const { called, waiting } = await readOpenTickets(dataSource, officeId, queueDate);
  const [{ served }] = await dataSource.query(
    "SELECT count(*)::int AS served FROM queue_tickets WHERE office_id = $1 AND queue_date = $2 AND status = 'SERVED'",
    [officeId, queueDate],
  );
  const dto = (r) => staffTicketDto(r, at.getTime());
  return {
    office_id: officeId,
    queue_date: queueDate,
    now: at.toISOString(),
    grace_seconds: QUEUE_SKIP_GRACE_MS / 1000,
    called: called.map(dto),
    waiting: waiting.map(dto),
    counts: {
      waiting: waiting.length,
      waiting_priority: waiting.filter((r) => r.lane === LANES.PRIORITY).length,
      called: called.length,
      served,
    },
    queue_empty: waiting.length === 0,
  };
}

/**
 * CC059 handoff ("Now serving", spec 8.5): the current ticket (the most recent call of today that is still CALLED, or the
 * most recently served one when nobody is being called) and the next three display numbers in call order. Display numbers
 * only: no ids, lanes, timestamps or anything about a person. CC059 adds its public route and polling on top of this.
 */
export async function readNowServing(manager, officeId, { now = new Date() } = {}) {
  const queueDate = toManilaDate(now);
  const { called, waiting } = await readOpenTickets(manager, officeId, queueDate);
  let current = called[0]?.ticket_no ?? null;
  if (!current) {
    const [last] = await manager.query(
      "SELECT ticket_no FROM queue_tickets WHERE office_id = $1 AND queue_date = $2 AND status = 'SERVED' ORDER BY served_at DESC, seq DESC LIMIT 1",
      [officeId, queueDate],
    );
    current = last?.ticket_no ?? null;
  }
  return { queue_date: queueDate, current, next: waiting.slice(0, 3).map((r) => r.ticket_no) };
}
