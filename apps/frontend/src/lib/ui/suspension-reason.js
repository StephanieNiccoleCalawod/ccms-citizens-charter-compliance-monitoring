// CC058: the reason category and the optional reference (memorandum number) of a campus suspension.
//
// BACKEND LIMITATION (checked when this was written): the Core calendar service does not store these. Its POST and PUT /exceptions
// read only the fields it knows, so `reason_category` and `reference` in a request are ignored, and its answers never contain them.
// This file keeps the screen ready for the day the service does:
//   - the two fields are sent only with a SUSPENSION, as extra fields beside the existing ones (nothing existing changes);
//   - what is shown is read from the entry (`reason_category`, `reference`), with the agreed fallbacks for an entry without them;
//   - `reasonSupportedBy` / `reasonStored` tell the screen whether the service really keeps them, so it never pretends.

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

/** Only a suspension carries a reason; holidays have none. */
export const hasReason = (type) => type === 'SUSPENSION';

/** What the form starts with: empty for a new entry (the person must choose), the saved values for a suspension being edited. */
export function reasonFormFrom(entry) {
  if (!entry || !hasReason(entry.exception_type)) return { reason_category: '', reference: '' };
  return { reason_category: isReasonCategory(entry.reason_category) ? entry.reason_category : DEFAULT_REASON, reference: normalizeReference(entry.reference) };
}

/** Field problems for the reason fields of a suspension: { reason_category?, reference? }. Nothing for any other type. */
export function reasonProblems(form) {
  if (!hasReason(form.exception_type)) return {};
  const problems = {};
  if (!form.reason_category) problems.reason_category = CATEGORY_REQUIRED;
  else if (!isReasonCategory(form.reason_category)) problems.reason_category = CATEGORY_UNKNOWN;
  const long = referenceError(form.reference);
  if (long) problems.reference = long;
  return problems;
}

/** The extra request fields: the category and the trimmed reference (null when empty) for a suspension, nothing otherwise. */
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
