import { Errors, ROLES } from 'ccms-shared';

/**
 * Roles that work with transactions: start, hold, resume, complete (and, for supervisors, cancel). Every write route checks
 * this list, so Executive gets 403 on all of them; ccms-shared requirePermission also refuses any Executive write method.
 */
export const OPERATOR_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

/**
 * Roles that may READ transactions (GET list and GET detail only). CC027 / K14 (approved backlog change) adds Executive:
 * read-only, across every office, and only through the allowlisted Executive view (dto.js toExecutiveTransactionDto).
 * This replaces the older BR-TXN-009 rule "Executive never sees citizen-service records" for reads; writes are unchanged.
 */
export const TRANSACTION_READ_ROLES = Object.freeze([...OPERATOR_ROLES, ROLES.EXECUTIVE]);

export const isExecutive = (user) => user?.role === ROLES.EXECUTIVE;

/**
 * Who may see and act on one transaction:
 *   Super Admin           any
 *   Office Head           the transactions of the office in their token
 *   Office Staff          their own (started_by) - even after a move to another office
 * Anyone else, including Executive, is refused. This is the WRITE rule (hold, resume, complete); reads use canReadTransaction.
 */
export function canAccessTransaction(user, row) {
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (user.role === ROLES.OFFICE_HEAD) return Boolean(user.officeId) && String(row.office_id) === String(user.officeId);
  if (user.role === ROLES.OFFICE_STAFF) return String(row.started_by) === String(user.id);
  return false;
}

export function assertCanAccess(user, row) {
  if (!canAccessTransaction(user, row)) throw Errors.forbidden();
}

/** Reading one transaction: the operator scope above, plus Executive for any office (K14). */
export function canReadTransaction(user, row) {
  if (isExecutive(user)) return true;
  return canAccessTransaction(user, row);
}

export function assertCanRead(user, row) {
  if (!canReadTransaction(user, row)) throw Errors.forbidden();
}

/** Cancelling is for supervisors only: Office Head of the office, or Super Admin (B11). */
export function assertCanCancel(user, row) {
  if (user.role === ROLES.SUPER_ADMIN) return;
  if (user.role === ROLES.OFFICE_HEAD && user.officeId && String(row.office_id) === String(user.officeId)) return;
  throw Errors.forbidden();
}
