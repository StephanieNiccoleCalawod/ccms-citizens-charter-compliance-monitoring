import { AppError, isUuid, toManilaDate } from 'ccms-shared';
import { QUEUE_STATUS } from './tickets.js';

// =================================================================================================================
// CC040: link a queue ticket at Start and record the waiting time, inside the Start's own database transaction.
//
// Request     POST /transactions { ..., queue_ticket_id?: <ticket uuid> }. Absent, null or '' = no ticket (the existing
//             ticket-free Start; transactions.queue_ticket_id and queue_wait_minutes stay null).
// Selectable  a ticket of the SAME office as the service being started, of TODAY's Manila date (the server's clock at the
//             request), with status WAITING or CALLED. The called ticket is the usual choice; a waiting one may be served
//             directly. SERVED (already linked to a transaction), an earlier day, another office or an unknown id is refused
//             with a field error on queue_ticket_id and nothing is saved.
// Measure     queue_wait_minutes = floor((started_at - issued_at) / 60 000), both server-side instants: started_at is the
//             effective start the row stores (the request time, or the backdated start), issued_at the ticket's ORIGINAL
//             issue time (a Skip or a recall never changes it). Whole completed minutes, so 0:59 is 0 - a measured zero,
//             which is not the same as null (no ticket). A start earlier than the issue is refused (no negative wait).
// Atomic      the ticket row is locked FOR UPDATE, checked, the transaction is inserted with the link and the wait, and the
//             ticket becomes SERVED with transaction_id - one database transaction. A failed Start rolls the claim back, so
//             the ticket stays available. Two Starts on one ticket serialise on the lock: the second sees SERVED and is
//             refused; transactions_queue_ticket_uq and queue_tickets_transaction_uq back this in the database.
// Never       part of compliance: the deadline, hold and on-time result never read these fields.
// =================================================================================================================

const FIELD = 'queue_ticket_id';
const fieldError = (status, code, message) => new AppError(status, code, message, { [FIELD]: message });

export const QUEUE_LINK_MESSAGES = Object.freeze({
  invalid: 'Choose a ticket from this office\'s queue.',
  expired: 'This ticket is from an earlier day. Start without a ticket or choose one of today\'s.',
  used: 'This ticket is already linked to another transaction.',
  beforeIssue: 'The start time is earlier than this ticket was issued. Start without a ticket or correct the start time.',
});

/** Reads queue_ticket_id from a Start body into `details` (field errors) and returns the id or null. */
export function parseQueueTicketChoice(body, details) {
  const value = body?.queue_ticket_id;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && isUuid(value.trim())) return value.trim().toLowerCase();
  details[FIELD] = QUEUE_LINK_MESSAGES.invalid;
  return null;
}

/** Whole completed minutes from the issue to the start, or null when the start is before the issue. */
export function queueWaitMinutes(issuedAt, startedAt) {
  const ms = new Date(startedAt).getTime() - new Date(issuedAt).getTime();
  return ms < 0 ? null : Math.floor(ms / 60_000);
}

/**
 * Locks and checks the ticket for a Start (call it inside the Start's database transaction, before the insert).
 * Returns { ticketId, ticketNo, waitMinutes }.
 */
export async function lockTicketForStart(manager, { ticketId, officeId, startedAt, requestTime }) {
  const [ticket] = await manager.query(
    `SELECT ticket_id, office_id, ticket_no, status, issued_at, to_char(queue_date, 'YYYY-MM-DD') AS queue_date
       FROM queue_tickets WHERE ticket_id = $1 FOR UPDATE`,
    [ticketId],
  );
  if (!ticket || String(ticket.office_id) !== String(officeId).toLowerCase()) throw fieldError(400, 'QUEUE_TICKET_INVALID', QUEUE_LINK_MESSAGES.invalid);
  if (ticket.status === QUEUE_STATUS.SERVED) throw fieldError(409, 'QUEUE_TICKET_USED', QUEUE_LINK_MESSAGES.used);
  if (ticket.queue_date !== toManilaDate(requestTime)) throw fieldError(409, 'QUEUE_TICKET_EXPIRED', QUEUE_LINK_MESSAGES.expired);
  const waitMinutes = queueWaitMinutes(ticket.issued_at, startedAt);
  if (waitMinutes === null) throw fieldError(400, 'QUEUE_TICKET_AFTER_START', QUEUE_LINK_MESSAGES.beforeIssue);
  return { ticketId: ticket.ticket_id, ticketNo: ticket.ticket_no, waitMinutes };
}

/** Marks the locked ticket SERVED by the new transaction (after the transaction row exists). */
export async function markTicketServed(manager, { ticketId, transactionId, servedAt }) {
  await manager.query(
    `UPDATE queue_tickets SET status = 'SERVED', served_at = $3, transaction_id = $2, version = version + 1
      WHERE ticket_id = $1 AND status IN ('WAITING', 'CALLED')`,
    [ticketId, transactionId, servedAt],
  );
}
