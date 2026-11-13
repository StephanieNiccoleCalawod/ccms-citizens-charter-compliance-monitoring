// CC039 queue helpers.
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
