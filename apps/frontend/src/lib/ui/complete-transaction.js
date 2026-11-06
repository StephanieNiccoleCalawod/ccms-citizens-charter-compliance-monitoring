// Rules for completing a transaction, as pure functions (no React, no network, no clock).
// The Operations service owns everything that matters: the end time (its own clock), the working minutes (worked out
// with Core), the compliance rule, and the audit entries TRANSACTION_COMPLETED and TRANSACTION_RESULT_COMPUTED.
// Nothing here calculates a result or invents a time: it only decides what to show from what the server returned.

export const COMPLETE_MESSAGES = {
  confirmTitle: 'Complete this transaction?',
  confirm: 'Completing records the end time now and checks the transaction against the standard that was saved when it started. This cannot be undone.',
  onHold: 'This transaction is pending. Resume it before completing it.',
  sessionEnded: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission to complete this transaction.',
  notFound: 'This transaction could not be found.',
  alreadyCompleted: 'This transaction was already completed. The details have been refreshed.',
  notInProgress: 'This transaction is no longer in progress, so it cannot be completed. The details have been refreshed.',
  mustResume: 'This transaction is pending. Resume it before completing it. The details have been refreshed.',
  unknownOutcome: 'We could not confirm whether the transaction was completed. Its current state is being checked; please do not try again until it is.',
  unknownStillUnclear: 'We still cannot tell whether the transaction was completed. Use "Check status" before trying again.',
  completedAfterUnknown: 'The transaction was completed. The details below come from the server.',
  stillInProgressAfterUnknown: 'The transaction was not completed. You can try again.',
  pendingNote: 'The transaction is completed. Its compliance result has not been computed yet, because the calendar could not be reached. The system fills it in later; use "Refresh result" to check.',
  serverError: 'The transaction could not be completed right now.',
};

/** Complete is offered only for a transaction the server reports as IN_PROGRESS. Who may act is decided by the server. */
export const canComplete = (transaction) => transaction?.status === 'IN_PROGRESS';

/** Pending (ON_HOLD): no Complete button, but the person is told why. */
export const mustResumeFirst = (transaction) => transaction?.status === 'ON_HOLD';

/**
 * What the compliance section shows, from the server's fields only:
 *   'compliant' / 'breach'   the server stored a result (is_compliant true / false)
 *   'pending'                COMPLETED and the server has stored no result yet (is_compliant and elapsed_working_minutes both null)
 *   'none'                   not finished, or no result applies
 * Never inferred from ended_at, elapsed time or a missing field alone beyond that exact "completed, nothing stored" state.
 */
export function complianceState(transaction) {
  if (!transaction) return 'none';
  if (transaction.is_compliant === true) return 'compliant';
  if (transaction.is_compliant === false) return 'breach';
  if (transaction.status === 'COMPLETED' && transaction.is_compliant == null && transaction.elapsed_working_minutes == null) return 'pending';
  return 'none';
}

// Display labels only: the keys are this file's own states, and the API's is_compliant / status values are not renamed.
export const COMPLIANCE_LABELS = { compliant: 'On time', breach: 'Late', pending: 'Awaiting result' };

const minutesText = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

/** 90 -> "1 hour 30 minutes", 45 -> "45 minutes". These are working minutes, so hours are only a regrouping of them. */
export function durationText(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutesText(minutes);
  const hourPart = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return minutes === 0 ? hourPart : `${hourPart} ${minutesText(minutes)}`;
}

/**
 * The API's variance_minutes, worded. Sign convention (Operations compliance rules): negative = finished before the
 * deadline (early), positive = finished after it (late), 0 = exactly on the deadline (on time). Display only.
 */
export function describeVariance(variance) {
  if (variance == null || !Number.isFinite(Number(variance))) return null;
  const n = Number(variance);
  if (n === 0) return 'On time (exactly at the standard)';
  return n < 0 ? `Early by ${durationText(-n)}` : `Late by ${durationText(n)}`;
}

/** The server's elapsed working minutes as "N minutes" (no conversion), or null while there is none. */
export const describeElapsed = (minutes) => (minutes == null || !Number.isFinite(Number(minutes)) ? null : minutesText(Number(minutes)));

/**
 * Turns a failed completion into what the screen does: { kind, message, reload, unknown }.
 * unknown = the request may or may not have been applied, so the state must be read back before any new attempt.
 */
export function completeErrorResult(err) {
  const status = err?.status;
  const code = err?.code;
  const result = (kind, message, { reload = false, unknown = false } = {}) => ({ kind, message, reload, unknown });
  if (status === 401) return result('auth', COMPLETE_MESSAGES.sessionEnded);
  if (status === 403) return result('forbidden', COMPLETE_MESSAGES.forbidden);
  if (status === 404) return result('notfound', COMPLETE_MESSAGES.notFound);
  if (status === 409 && code === 'INVALID_STATE') {
    const now = err.details?.status;
    if (now === 'ON_HOLD') return result('on_hold', COMPLETE_MESSAGES.mustResume, { reload: true });
    if (now === 'COMPLETED') return result('already_completed', COMPLETE_MESSAGES.alreadyCompleted, { reload: true });
    return result('invalid_state', COMPLETE_MESSAGES.notInProgress, { reload: true });
  }
  if (status === 400 && err.details && typeof err.details === 'object') {
    const first = Object.values(err.details).find((v) => typeof v === 'string');
    const fieldErrors = {};
    for (const field of ['ended_at', 'backdate_reason']) if (typeof err.details[field] === 'string') fieldErrors[field] = err.details[field];
    if (first) return { ...result('validation', first, { reload: true }), fieldErrors };
  }
  if (code === 'NETWORK_ERROR') return result('network', COMPLETE_MESSAGES.unknownOutcome, { reload: true, unknown: true });
  // A 5xx or gateway failure can arrive after the end time was saved: treat the outcome as unknown.
  if (status >= 500 || status === undefined) return result('server', COMPLETE_MESSAGES.unknownOutcome, { reload: true, unknown: true });
  return result('server', COMPLETE_MESSAGES.serverError, { reload: true, unknown: true });
}

/** What to tell the person once the state has been read back after an unclear outcome (the server's status decides). */
export function reconcileBanner(status) {
  if (status === 'IN_PROGRESS') return { variant: 'warning', message: COMPLETE_MESSAGES.stillInProgressAfterUnknown };
  if (status === 'COMPLETED') return { variant: 'info', message: COMPLETE_MESSAGES.completedAfterUnknown };
  if (status === 'ON_HOLD') return { variant: 'info', message: COMPLETE_MESSAGES.mustResume };
  return { variant: 'info', message: COMPLETE_MESSAGES.notInProgress };
}
