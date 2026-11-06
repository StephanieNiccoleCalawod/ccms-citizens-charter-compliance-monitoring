// Rules for recording a past transaction (CC026), as pure functions (no React, no network). The clock is passed in.
//
// The Operations service owns everything that matters: it reads started_at / ended_at, refuses the future and an end that is
// not after the start (400, by field), picks the standard in force on the Manila date of the start (Core), flags the
// record is_backdated, writes TRANSACTION_BACKDATED and works out the compliance result. This only gives early feedback
// and puts what the person typed into the form the service reads.
//
// A date and time typed here is Manila time (Asia/Manila is a fixed UTC+08:00 with no daylight saving). It is sent
// as "YYYY-MM-DDTHH:mm:ss+08:00", the ISO form with an offset that the service requires. Nothing is converted with the
// browser's own time zone, and nothing is worked out beyond comparing two typed times.

export const BACKDATE_REASON_MAX = 500;

export const BACKDATE_MESSAGES = {
  startRequired: 'Enter when the transaction started (Manila time).',
  startInvalid: 'Enter the start as a valid date and time.',
  startFuture: 'The start time cannot be in the future.',
  endRequired: 'Enter when the transaction ended (Manila time).',
  endInvalid: 'Enter the end as a valid date and time.',
  endFuture: 'The end time cannot be in the future.',
  endAfterStart: 'The end time must be after the start time.',
  reasonRequired: 'Enter why this time is entered after the fact.',
  reasonTooLong: `The reason must be ${BACKDATE_REASON_MAX} characters or fewer.`,
  ambiguous: 'We could not confirm whether this record was saved. Do not submit it again until you have checked the saved records below.',
  checkFailed: 'The saved records could not be checked right now. Please try again; do not submit again until the check works.',
};

export const EMPTY_PAST = Object.freeze({ enabled: false, started_at: '', manual_end: false, ended_at: '', reason: '' });

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** The typed Manila date and time as an instant (ms since 1970), or null when it is not a real date and time. */
export function manilaInstant(value) {
  const match = typeof value === 'string' ? INPUT.exec(value) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00'] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const check = new Date(ms);
  // Rejects 2026-02-30 and the like, which Date.UTC would quietly roll into March.
  if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return null;
  return ms - 8 * 60 * 60 * 1000;
}

/** "2026-10-01T09:30" -> "2026-10-01T09:30:00+08:00" (the form the service reads), or null when it is not valid. */
export function manilaIso(value) {
  if (manilaInstant(value) === null) return null;
  return `${value}${INPUT.exec(value)[6] === undefined ? ':00' : ''}+08:00`;
}

/** The Manila calendar date typed in the start ("2026-10-01"), used to ask Core for the standard of that day. Null when invalid. */
export const manilaDateOf = (value) => (manilaInstant(value) === null ? null : value.slice(0, 10));

/**
 * Early feedback for the past-transaction fields, by field name the service uses: { started_at, ended_at, backdate_reason }.
 * Empty when there is nothing wrong (or the option is off). nowMs is the current time, passed in.
 * Mirrors the service: start strictly before now; end not after now and strictly after the start; one reason of 1-500 characters.
 */
export function backdateErrors(past, nowMs) {
  const errors = {};
  if (!past?.enabled) return errors;
  const start = manilaInstant(past.started_at);
  if (!past.started_at) errors.started_at = BACKDATE_MESSAGES.startRequired;
  else if (start === null) errors.started_at = BACKDATE_MESSAGES.startInvalid;
  else if (start >= nowMs) errors.started_at = BACKDATE_MESSAGES.startFuture;

  if (past.manual_end) {
    const end = manilaInstant(past.ended_at);
    if (!past.ended_at) errors.ended_at = BACKDATE_MESSAGES.endRequired;
    else if (end === null) errors.ended_at = BACKDATE_MESSAGES.endInvalid;
    else if (end > nowMs) errors.ended_at = BACKDATE_MESSAGES.endFuture;
    else if (start !== null && end <= start) errors.ended_at = BACKDATE_MESSAGES.endAfterStart;
  }

  const reason = typeof past.reason === 'string' ? past.reason.trim() : '';
  if (!reason) errors.backdate_reason = BACKDATE_MESSAGES.reasonRequired;
  else if (reason.length > BACKDATE_REASON_MAX) errors.backdate_reason = BACKDATE_MESSAGES.reasonTooLong;
  return errors;
}

/**
 * Adds the past-transaction fields to the body of POST /transactions: started_at, backdate_reason and (only when entered by
 * hand) ended_at. Returns the body unchanged when the option is off. With ended_at the service records a finished
 * transaction in this one request. No result, status or audit field is ever sent.
 */
export function withBackdate(body, past) {
  if (!past?.enabled) return body;
  const next = { ...body, started_at: manilaIso(past.started_at), backdate_reason: past.reason.trim() };
  if (past.manual_end) next.ended_at = manilaIso(past.ended_at);
  return next;
}

/**
 * A failed past-transaction write whose outcome is unknown: no answer at all, or a server/gateway failure that could have
 * come after the record was saved. A 503 CATALOGUE_UNAVAILABLE is different: the service refuses before saving anything.
 */
export function isAmbiguousWrite(err) {
  if (err?.code === 'NETWORK_ERROR') return true;
  const status = err?.status;
  if (status === undefined) return true;
  if (status === 503 && err.code === 'CATALOGUE_UNAVAILABLE') return false;
  return status >= 500;
}

/** The service's own words when no standard was in force on the day of the start; otherwise null. */
export function pastStandardMessage(err) {
  if (err?.status === 409 && err.code === 'STANDARD_NOT_IN_FORCE' && typeof err.message === 'string' && /^No standard was in force for this service on \d{2}\/\d{2}\/\d{4}$/.test(err.message)) return err.message;
  return null;
}

// ---- Completing a transaction that is already open, with an end time entered by hand (CC026) ----
// POST /transactions/:id/complete accepts { ended_at, backdate_reason } (never started_at: the stored start stays). The
// service refuses an end that is not after the stored start or that is in the future, and requires the reason (1-500).

export const EMPTY_MANUAL_END = Object.freeze({ enabled: false, ended_at: '', reason: '' });

export const COMPLETION_END_MESSAGES = {
  endBeforeStoredStart: 'The end time must be after the time the transaction started.',
};

/**
 * Early feedback for a manual end on an open transaction: { ended_at, backdate_reason }, empty when fine or when the
 * option is off. startedAtIso is the start the SERVER returned (an ISO time with an offset); nowMs is passed in.
 * Same rules as the form for a new past transaction: required, a real time, not in the future, strictly after the start.
 */
export function manualEndErrors(manual, startedAtIso, nowMs) {
  const errors = {};
  if (!manual?.enabled) return errors;
  const end = manilaInstant(manual.ended_at);
  const start = Date.parse(startedAtIso);
  if (!manual.ended_at) errors.ended_at = BACKDATE_MESSAGES.endRequired;
  else if (end === null) errors.ended_at = BACKDATE_MESSAGES.endInvalid;
  else if (end > nowMs) errors.ended_at = BACKDATE_MESSAGES.endFuture;
  else if (Number.isFinite(start) && end <= start) errors.ended_at = COMPLETION_END_MESSAGES.endBeforeStoredStart;
  const reason = typeof manual.reason === 'string' ? manual.reason.trim() : '';
  if (!reason) errors.backdate_reason = BACKDATE_MESSAGES.reasonRequired;
  else if (reason.length > BACKDATE_REASON_MAX) errors.backdate_reason = BACKDATE_MESSAGES.reasonTooLong;
  return errors;
}

/** The body of POST /complete: undefined for an ordinary completion, { ended_at, backdate_reason } for a manual end. */
export function completionBody(manual) {
  if (!manual?.enabled) return undefined;
  return { ended_at: manilaIso(manual.ended_at), backdate_reason: manual.reason.trim() };
}
