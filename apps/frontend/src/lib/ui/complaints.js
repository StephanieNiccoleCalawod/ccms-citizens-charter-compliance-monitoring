// Rules for the public complaint form and status page (CC032 / CC033), as pure functions. The wording says "complaint" (C-07).
// The category list mirrors COMPLAINT_CATEGORIES in the Oversight service (a test compares the two); the service decides.
export const CATEGORIES = Object.freeze([
  { value: 'REFUSAL_TO_ACCEPT', label: 'Refusal to accept a complete application or request' },
  { value: 'ADDITIONAL_REQUIREMENTS', label: 'Requirements added that were not in the Citizen’s Charter' },
  { value: 'ADDITIONAL_COSTS', label: 'Costs charged that are not in the Citizen’s Charter' },
  { value: 'NO_WRITTEN_NOTICE', label: 'No written notice of disapproval' },
  { value: 'DELAYED_SERVICE', label: 'Service not given within the processing time' },
  { value: 'NOT_ATTENDED', label: 'Not attended to during official hours or lunch break' },
  { value: 'NO_OFFICIAL_RECEIPT', label: 'No official receipt issued' },
  { value: 'FIXING', label: 'Fixing or dealing with fixers' },
  { value: 'OTHER', label: 'Other' },
]);
export const LIMITS = Object.freeze({ description: 2000, name: 200, email: 254, tracking: 60 });
export const EMPTY_FORM = Object.freeze({ office_id: '', category: '', description: '', tracking_no: '', name: '', email: '' });
export const STATUS_LABELS = Object.freeze({ RECEIVED: 'Received' });
export const statusLabel = (status) => STATUS_LABELS[status] ?? 'In progress';
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** Early feedback by field; the service checks again and its field messages are shown the same way. */
export function formErrors(form) {
  const e = {};
  if (!form.office_id) e.office_id = 'Choose the office.';
  if (!form.category) e.category = 'Choose a category.';
  const description = String(form.description ?? '').trim();
  if (!description) e.description = 'Describe what happened.';
  else if (description.length > LIMITS.description) e.description = `The description must be ${LIMITS.description} characters or fewer.`;
  if (String(form.tracking_no ?? '').trim().length > LIMITS.tracking) e.tracking_no = `The tracking number must be ${LIMITS.tracking} characters or fewer.`;
  if (String(form.name ?? '').trim().length > LIMITS.name) e.name = `The name must be ${LIMITS.name} characters or fewer.`;
  const email = String(form.email ?? '').trim();
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email))) e.email = 'Enter a valid email address.';
  return e;
}

export const remaining = (form) => LIMITS.description - String(form.description ?? '').length;

/** The reference as typed: spaces removed, upper case. */
export const normalizeReference = (text) => String(text ?? '').replace(/\s+/g, '').toUpperCase();
export const referenceError = (text) => (normalizeReference(text) ? '' : 'Enter your reference number.');

/** What to tell the person about a failed request. Field problems from the service are returned by field. */
export function describeFailure(error) {
  if (error?.status === 400 && error.details && typeof error.details === 'object') return { message: 'Please correct the highlighted fields.', fields: error.details };
  if (error?.status === 429) return { message: error.message, fields: {} };
  if (error?.status === 503) return { message: 'Complaints cannot be filed right now. Please try again later.', fields: {} };
  return { message: error?.message || 'Something went wrong. Please try again in a few minutes.', fields: {} };
}

/** The privacy notice link, only when the institution has provided one (NEXT_PUBLIC_PRIVACY_NOTICE_URL). */
export const privacyNoticeUrl = (env = process.env) => {
  const url = String(env.NEXT_PUBLIC_PRIVACY_NOTICE_URL ?? '').trim();
  return /^(https?:\/\/|\/)/.test(url) ? url : '';
};
