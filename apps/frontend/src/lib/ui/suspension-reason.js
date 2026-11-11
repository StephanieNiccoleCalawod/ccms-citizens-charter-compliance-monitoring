// CC058: reason category and optional reference for saved calendar entries.

export const REASON_CATEGORIES = Object.freeze([
  { value: 'TYPHOON_WEATHER', label: 'Typhoon / Weather' },
  { value: 'HEAT_INDEX', label: 'Heat Index' },
  { value: 'POWER_WATER_OUTAGE', label: 'Power / Water Outage' },
  { value: 'EARTHQUAKE_DRILL', label: 'Earthquake / Drill' },
  { value: 'SECURITY_THREAT', label: 'Security Threat' },
  { value: 'HOLIDAY_PROCLAMATION', label: 'Holiday Proclamation' },
  { value: 'UNIVERSITY_EVENT', label: 'University Event' },
  { value: 'OTHER', label: 'Other' },
]);

export const DEFAULT_REASON = 'OTHER';
export const REFERENCE_MAX = 100;
export const NO_REFERENCE = '—';
export const CATEGORY_REQUIRED = 'Choose a reason category';
export const CATEGORY_UNKNOWN = 'Choose a reason from the list';
export const REFERENCE_TOO_LONG = `Reference must be ${REFERENCE_MAX} characters or fewer`;

export const REASON_NOT_STORED_NOTICE =
  'The calendar service does not store the reason category or reference yet, so they were not kept with this entry. The entry itself was saved.';

const VALUES = new Set(REASON_CATEGORIES.map((c) => c.value));
export const isReasonCategory = (value) => typeof value === 'string' && VALUES.has(value);

/** The readable name of a category. An entry with no (or an unrecognised) category is shown as Other. */
export function reasonLabel(value) {
  return REASON_CATEGORIES.find((c) => c.value === value)?.label ?? REASON_CATEGORIES.find((c) => c.value === DEFAULT_REASON).label;
}

/** The text without leading or trailing spaces ('' when there is nothing). */
export const normalizeReference = (value) => (typeof value === 'string' ? value.trim() : '');

/** The reference for display: the text, or a dash. A memorandum number is never made up. */
export const referenceLabel = (value) => normalizeReference(value) || NO_REFERENCE;

export const referenceCounter = (value) => `${normalizeReference(value).length}/${REFERENCE_MAX}`;
export const referenceError = (value) => (normalizeReference(value).length > REFERENCE_MAX ? REFERENCE_TOO_LONG : null);

export const hasReason = (type) => ['SUSPENSION', 'REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'LOCAL_HOLIDAY'].includes(type);

/** New entries start without a category. Edits show the saved values. */
export function reasonFormFrom(entry) {
  if (!entry || !hasReason(entry.exception_type)) return { reason_category: '', reference: '' };
  return { reason_category: isReasonCategory(entry.reason_category) ? entry.reason_category : DEFAULT_REASON, reference: normalizeReference(entry.reference) };
}

/** Field errors for the category and optional reference. */
export function reasonProblems(form) {
  if (!hasReason(form.exception_type)) return {};
  const problems = {};
  if (!form.reason_category) problems.reason_category = CATEGORY_REQUIRED;
  else if (!isReasonCategory(form.reason_category)) problems.reason_category = CATEGORY_UNKNOWN;
  const long = referenceError(form.reference);
  if (long) problems.reference = long;
  return problems;
}

/** Include the category and trimmed reference in the calendar save. */
export function reasonBody(form) {
  if (!hasReason(form.exception_type)) return {};
  return { reason_category: form.reason_category, reference: normalizeReference(form.reference) || null };
}

/** The two lines shown for a saved suspension. */
export function reasonDisplay(entry) {
  return { category: reasonLabel(entry?.reason_category), reference: referenceLabel(entry?.reference) };
}

/** True when the service's answers carry the field at all (even as null): it knows about reasons. */
export const reasonSupportedBy = (entries) => Array.isArray(entries) && entries.some((e) => e && typeof e === 'object' && 'reason_category' in e);

/** True when the answer to a save carries the field: the entry was stored with it. */
export function reasonStored(answer) {
  const entry = answer && typeof answer === 'object' ? (answer.exception ?? answer) : null;
  return Boolean(entry) && typeof entry === 'object' && 'reason_category' in entry;
}
