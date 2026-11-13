// CC039 / CC040 queue helpers (pure, tested in tests/unit/queue.test.js).
import { ROLES } from 'ccms-shared/roles';

export const PRIORITY_OPTIONS = Object.freeze([
  { value: '', label: 'No, regular line' },
  { value: 'SENIOR_CITIZEN', label: 'Senior citizen' },
  { value: 'PWD', label: 'Person with disability' },
  { value: 'PREGNANT', label: 'Pregnant' },
]);

export const QUEUE_PAGE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const queueNav = (role) => (QUEUE_PAGE_ROLES.includes(role) ? { section: 'Main', label: 'Queue', href: '/queue' } : null);

export const laneLabel = (lane) => (lane === 'PRIORITY' ? 'Priority' : 'Regular');

/** "Skip available in 1:05" / "Skip available now" for a called ticket, from the server's skippable_at and the clock. */
export function skipCountdown(ticket, nowMs) {
  if (!ticket?.skippable_at) return null;
  const left = Date.parse(ticket.skippable_at) - nowMs;
  if (!(left > 0)) return { ready: true, text: 'Skip is available now' };
  const seconds = Math.ceil(left / 1000);
  return { ready: false, text: `Skip available in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` };
}

/** What the public page says after a failed request. */
export function describeTakeFailure(error) {
  if (error?.status === 429) {
    const wait = error.retryAfterSeconds;
    const minutes = wait ? Math.ceil(wait / 60) : null;
    return { message: `Too many tickets were requested from this device.${minutes ? ` Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.` : ' Please wait a moment and try again.'}`, fields: {} };
  }
  if (error?.status === 400 && error.details) {
    const fields = {};
    if (error.details.office_id) fields.office_id = error.details.office_id;
    if (error.details.priority_group) fields.priority_group = error.details.priority_group;
    return { message: Object.keys(fields).length ? '' : error.message, fields };
  }
  if (error?.status === 503) return { message: 'Tickets cannot be issued right now. Please try again in a few minutes or ask the office staff.', fields: {} };
  return { message: error?.message || 'Something went wrong. Please try again.', fields: {} };
}

/**
 * CC040: the choices of the ticket picker on the Start form, from the queue board of the service's office. Called tickets first
 * (the usual choice, newest call first), then the waiting line in call order. Each label is the display number only.
 */
export function ticketPickerOptions(board) {
  const called = (board?.called ?? []).map((t) => ({ value: t.ticket_id, label: `${t.ticket_no} (called now${t.lane === 'PRIORITY' ? ', priority' : ''})`, called: true }));
  const waiting = (board?.waiting ?? []).map((t) => ({ value: t.ticket_id, label: `${t.ticket_no} (waiting${t.lane === 'PRIORITY' ? ', priority' : ''})`, called: false }));
  return [...called, ...waiting];
}

/** "12 min" / "0 min" for a measured wait, null when there was no ticket (never shown as 0). */
export function queueWaitText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return null;
  return `${Number(minutes)} min`;
}

/** A report/KPI bucket's queue wait: "8.5 min average (12 measured)", "Not measured" when nothing was, '-' for an older report. */
export function queueWaitFigure(bucket) {
  const q = bucket?.queue_wait;
  if (!q) return '-';
  if (!q.measured) return 'Not measured';
  return `${q.average_minutes} min average (${q.measured} measured)`;
}
