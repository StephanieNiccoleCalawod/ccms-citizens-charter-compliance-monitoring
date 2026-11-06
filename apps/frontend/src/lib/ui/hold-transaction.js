// Rules for putting a transaction on hold and resuming it, as pure functions (no React, no network).
// The Operations service owns the status change, the held working minutes (worked out with Core) and the audit
// entries; this only decides what to show and explains the answers.

export const HOLD_REASON_MAX = 500;

export const HOLD_MESSAGES = {
  reasonRequired: 'Enter a reason for the hold.',
  reasonTooLong: `The reason must be ${HOLD_REASON_MAX} characters or fewer.`,
  sessionEnded: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission to change this transaction.',
  notFound: 'This transaction could not be found.',
  holdDisabled: 'Hold is turned off for this institution, so the transaction cannot be put on hold.',
  notInProgress: 'This transaction is no longer in progress, so it cannot be put on hold. The details have been refreshed.',
  alreadyOnHold: 'This transaction is already pending. The details have been refreshed.',
  notOnHold: 'This transaction is no longer pending. The details have been refreshed.',
  versionConflict: 'This transaction was changed by someone else. The details have been refreshed; check them and try again.',
  calendarDown: 'The calendar cannot be reached right now, so the transaction could not be resumed. It is still pending. Please try again in a moment.',
  holdServerError: 'The transaction could not be put on hold right now. Please try again in a few minutes.',
  resumeServerError: 'The transaction could not be resumed right now. It is still pending. Please try again in a few minutes.',
};

/** The trimmed reason, or the message that explains why it is not acceptable. Mirrors the server's 1-500 rule. */
export function validateHoldReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) return { reason, error: HOLD_MESSAGES.reasonRequired };
  if (reason.length > HOLD_REASON_MAX) return { reason, error: HOLD_MESSAGES.reasonTooLong };
  return { reason, error: null };
}

/**
 * Hold is offered only when the server says hold is on (settings.hold_enabled === true, never assumed) and the
 * transaction the server returned is IN_PROGRESS. Who may act is decided by the server: it only returns a
 * transaction to someone who may also hold it (own for Office Staff, the office for Office Head, any for Super Admin).
 */
export const canHold = (transaction, holdEnabled) => holdEnabled === true && transaction?.status === 'IN_PROGRESS';

/** Resume is offered for a transaction the server reports as ON_HOLD, even when hold has since been switched off. */
export const canResume = (transaction) => transaction?.status === 'ON_HOLD';

/** The held working minutes the server reports, as "1 hour 5 minutes". Not converted to days: a working day's length is the calendar's. */
export function formatHeldMinutes(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '0 minutes';
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (rest || !hours) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

/** What to do with a failed load of the transaction. */
export function loadErrorResult(err) {
  const status = err?.status;
  if (status === 401) return { kind: 'auth', message: HOLD_MESSAGES.sessionEnded };
  if (status === 403) return { kind: 'forbidden', message: HOLD_MESSAGES.forbidden };
  if (status === 404) return { kind: 'notfound', message: HOLD_MESSAGES.notFound };
  if (err?.code === 'NETWORK_ERROR') return { kind: 'network', message: err.message };
  return { kind: 'server', message: 'The transaction could not be loaded right now. Please try again in a few minutes.' };
}

/**
 * Turns a failed hold or resume into what the screen does: { kind, message, reload }.
 * reload means the server's state moved on (or may have), so the details must be read again.
 */
export function holdActionError(err, action) {
  const status = err?.status;
  const code = err?.code;
  const result = (kind, message, reload = false) => ({ kind, message, reload, fieldError: null });
  if (status === 400 && typeof err.details?.reason === 'string') return { kind: 'validation', message: null, reload: false, fieldError: err.details.reason };
  if (status === 401) return result('auth', HOLD_MESSAGES.sessionEnded);
  if (status === 403) return result('forbidden', HOLD_MESSAGES.forbidden);
  if (status === 404) return result('notfound', HOLD_MESSAGES.notFound);
  if (status === 409 && code === 'HOLD_DISABLED') return result('hold_disabled', HOLD_MESSAGES.holdDisabled, true);
  if (status === 409 && code === 'INVALID_STATE') {
    const now = err.details?.status;
    if (action === 'hold') return result('invalid_state', now === 'ON_HOLD' ? HOLD_MESSAGES.alreadyOnHold : HOLD_MESSAGES.notInProgress, true);
    return result('invalid_state', HOLD_MESSAGES.notOnHold, true);
  }
  if (status === 409 && code === 'VERSION_CONFLICT') return result('version_conflict', HOLD_MESSAGES.versionConflict, true);
  if (status === 503 && code === 'CALENDAR_UNAVAILABLE') return result('calendar_unavailable', HOLD_MESSAGES.calendarDown);
  if (status === 502 || status === 503 || status === 504) return result('unavailable', action === 'hold' ? HOLD_MESSAGES.holdServerError : HOLD_MESSAGES.calendarDown);
  if (code === 'NETWORK_ERROR') return result('network', `${err.message}${action === 'resume' ? ' The transaction may still be pending; the details will be checked again.' : ''}`, action === 'resume');
  return result('server', action === 'hold' ? HOLD_MESSAGES.holdServerError : HOLD_MESSAGES.resumeServerError, true);
}
