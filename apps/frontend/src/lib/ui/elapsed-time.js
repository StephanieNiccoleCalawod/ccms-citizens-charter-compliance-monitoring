// Elapsed time of a transaction, as pure functions (no React, no clock of their own: the caller passes "now").
// started_at, ended_at and hold_started_at from the API are the only inputs; nothing is stored or invented.
//
// This is time on the clock since the transaction started. It is NOT the working time the standard is measured in:
// that is computed by the server (see "Compared with the standard") and may leave out nights, weekends and held time.

/** Milliseconds for an ISO timestamp from the API (they carry an offset, so Manila and UTC read the same). null when missing or invalid. */
export function parseInstant(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * What the elapsed-time field shows for a transaction at `nowMs`:
 *   { kind: 'live', ms }         IN_PROGRESS: counts up from started_at
 *   { kind: 'paused', ms }       ON_HOLD (shown as Pending): stops at hold_started_at, so the pause is not added
 *   { kind: 'final', ms }        COMPLETED: started_at to ended_at, fixed
 *   { kind: 'unavailable' }      CANCELLED (the API records no end time for it), AUTO_CLOSED without ended_at, or a bad timestamp
 */
export function elapsedState(tx, nowMs) {
  const start = parseInstant(tx?.started_at);
  if (start === null || !Number.isFinite(nowMs)) return { kind: 'unavailable' };
  const span = (end) => ({ ms: Math.max(0, end - start) });
  switch (tx.status) {
    case 'IN_PROGRESS':
      return { kind: 'live', ...span(nowMs) };
    case 'ON_HOLD': {
      const held = parseInstant(tx.hold_started_at);
      return held === null ? { kind: 'unavailable' } : { kind: 'paused', ...span(held) };
    }
    case 'COMPLETED':
    case 'AUTO_CLOSED': {
      const end = parseInstant(tx.ended_at);
      return end === null ? { kind: 'unavailable' } : { kind: 'final', ...span(end) };
    }
    default:
      return { kind: 'unavailable' };
  }
}

const unit = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "25 minutes 34 seconds", "2 hours 15 minutes 34 seconds", "1 day 3 hours 15 minutes" (a day or more drops the seconds).
 * Parts that are zero are left out; zero itself reads "0 seconds".
 */
export function formatElapsed(ms) {
  const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [];
  if (days > 0) parts.push(unit(days, 'day', 'days'));
  if (days > 0 || hours > 0) {
    if (hours > 0) parts.push(unit(hours, 'hour', 'hours'));
  }
  if (minutes > 0) parts.push(unit(minutes, 'minute', 'minutes'));
  if (days === 0 && (seconds > 0 || parts.length === 0)) parts.push(unit(seconds, 'second', 'seconds'));
  return parts.join(' ');
}
