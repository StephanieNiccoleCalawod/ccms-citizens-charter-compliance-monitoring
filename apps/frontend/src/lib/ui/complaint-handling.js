// Rules for the staff complaints screens (CC034 / CC035), as pure functions.
import { ROLES } from 'ccms-shared/roles';
import { formatDateTime } from './date-format.js';

export const REPLY_MAX = 2000;
export const STATUS_LABEL = Object.freeze({ RECEIVED: 'Received', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' });
export const STATUS_FILTERS = Object.freeze([['', 'All'], ['RECEIVED', 'Received'], ['ACKNOWLEDGED', 'Acknowledged'], ['RESOLVED', 'Resolved']]);

/** Super Admin and Office Head acknowledge and resolve; the Executive and Office Staff only read (the server enforces the same). */
export const canHandleComplaints = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD;
/** Only these two see the citizen's name and email (the server omits them for the others). */
export const seesContact = canHandleComplaints;

/** What the detail screen offers for a complaint: forward only. */
export function complaintActions(complaint, role) {
  const handler = canHandleComplaints(role);
  return {
    acknowledge: handler && complaint?.status === 'RECEIVED',
    resolve: handler && complaint?.status === 'ACKNOWLEDGED',
  };
}

export function statusText(complaint) {
  const base = STATUS_LABEL[complaint?.status] ?? complaint?.status ?? '-';
  return complaint?.overdue ? `${base}, overdue` : base;
}
export const dueText = (complaint) => (complaint?.due_at ? formatDateTime(complaint.due_at) : 'Not available yet');

export function replyError(reply) {
  const text = String(reply ?? '').trim();
  if (!text) return 'Write the reply to resolve this complaint.';
  if (text.length > REPLY_MAX) return `The reply must be ${REPLY_MAX} characters or fewer.`;
  return '';
}

export function failureMessage(error) {
  if (error?.code === 'COMPLAINT_INVALID_STATE') return error.message || 'This complaint has already moved on. Reload to see its current status.';
  if (error?.status === 403) return 'You do not have permission to do this.';
  if (error?.status === 404) return 'This complaint could not be found.';
  return error?.message || 'Something went wrong. Please try again in a few minutes.';
}
