// Rules for cancelling a transaction (CC025), as pure functions (no React, no network, no clock).
// The Operations service owns the transition: it sets CANCELLED, saves the reason, clears the hold, adds no held minutes,
// leaves the end time empty and writes the TRANSACTION_CANCELLED audit entry. This only decides what to show.
import { ROLES } from 'ccms-shared/roles';

export const CANCEL_REASON_MAX = 500;

export const CANCEL_MESSAGES = {
  reasonRequired: 'Enter a reason for cancelling.',
  reasonTooLong: `The reason must be ${CANCEL_REASON_MAX} characters or fewer.`,
  title: 'Cancel this transaction?',
  warning: 'Cancelling closes the transaction without completing it. No end time or compliance result is recorded, and this cannot be undone. The reason is saved with the transaction.',
  success: 'The transaction has been cancelled.',
  sessionEnded: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission to cancel this transaction. Only the Office Head of its office or a Super Admin can.',
  notFound: 'This transaction could not be found.',
  notOpen: 'This transaction is no longer open, so it cannot be cancelled. The details have been refreshed.',
  unknownOutcome: 'We could not confirm whether the transaction was cancelled. Its current state is being checked; please do not try again until it is.',
  serverError: 'The transaction could not be cancelled right now.',
};

/** The roles that may cancel (the server answers 403 to everyone else, Office Staff and Executive included). */
export const CANCEL_ROLES = [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD];

/**
 * Cancel is offered to Office Head and Super Admin, for a transaction the server reports as IN_PROGRESS or ON_HOLD.
 * The office rule is the server's: it only returns a transaction to an Office Head of its own office (anything else is 403).
 */
export const canCancel = (transaction, role) => CANCEL_ROLES.includes(role) && (transaction?.status === 'IN_PROGRESS' || transaction?.status === 'ON_HOLD');

/** The trimmed reason, or the message saying why it is not acceptable. Mirrors the server's 1-500 rule. */
export function validateCancelReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) return { reason, error: CANCEL_MESSAGES.reasonRequired };
  if (reason.length > CANCEL_REASON_MAX) return { reason, error: CANCEL_MESSAGES.reasonTooLong };
  return { reason, error: null };
}

/**
 * Turns a failed cancellation into what the screen does: { kind, message, fieldError, reload, unknown }.
 * unknown = the request may or may not have been applied, so the state must be read back before any new attempt.
 */
export function cancelErrorResult(err) {
  const status = err?.status;
  const code = err?.code;
  const result = (kind, message, { reload = false, unknown = false } = {}) => ({ kind, message, fieldError: null, reload, unknown });
  if (status === 400 && typeof err.details?.reason === 'string') return { kind: 'validation', message: null, fieldError: err.details.reason, reload: false, unknown: false };
  if (status === 401) return result('auth', CANCEL_MESSAGES.sessionEnded);
  if (status === 403) return result('forbidden', CANCEL_MESSAGES.forbidden);
  if (status === 404) return result('notfound', CANCEL_MESSAGES.notFound);
  if (status === 409 && code === 'INVALID_STATE') return result('invalid_state', CANCEL_MESSAGES.notOpen, { reload: true });
  if (code === 'NETWORK_ERROR') return result('network', CANCEL_MESSAGES.unknownOutcome, { reload: true, unknown: true });
  // A 5xx or gateway failure can arrive after the cancellation was saved: the outcome is unknown.
  return result('server', status >= 500 || status === undefined ? CANCEL_MESSAGES.unknownOutcome : CANCEL_MESSAGES.serverError, { reload: true, unknown: true });
}

/** What to tell the person after the state was read back following an unclear cancellation (the server's status decides). */
export function cancelReconcileBanner(status) {
  if (status === 'CANCELLED') return { variant: 'info', message: 'The transaction was cancelled. The details below come from the server.' };
  if (status === 'IN_PROGRESS' || status === 'ON_HOLD') return { variant: 'warning', message: 'The transaction was not cancelled. You can try again.' };
  return { variant: 'info', message: CANCEL_MESSAGES.notOpen };
}
