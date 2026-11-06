// A native <input type="time"> shows 12-hour AM/PM or 24-hour according to the person's device, but its value is always "HH:mm"
// (24-hour), which is the format the API uses too. So 1:00 PM is "13:00", 9:30 AM "09:30", 12:00 AM "00:00" and 12:00 PM "12:00".

export const INVALID_TIME_MESSAGE = 'Enter a valid time.';
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** What the API holds ("13:00" or "13:00:00") as the input's value ("13:00"); '' when there is none or it is unreadable. */
export function timeInputValue(apiValue) {
  const match = typeof apiValue === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(apiValue.trim()) : null;
  return match ? `${match[1]}:${match[2]}` : '';
}

/** The input's value as the API wants it: { value: 'HH:mm' | null (empty), error: null | message }. */
export function timeToApi(inputValue) {
  const text = typeof inputValue === 'string' ? inputValue.trim() : '';
  if (text === '') return { value: null, error: null };
  return HH_MM.test(text) ? { value: text, error: null } : { value: null, error: INVALID_TIME_MESSAGE };
}

export const END_REQUIRED_MESSAGE = 'Enter the time the suspension ends.';
export const START_REQUIRED_MESSAGE = 'Enter the time the suspension starts.';
export const END_AFTER_START_MESSAGE = 'The end time must be later than the start time.';

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * "Suspended from" and "Suspended until" together. Both empty is a whole-day suspension. A part-day suspension has both, and the
 * end is later than the start. Returns { from, until (HH:mm or null), errors: { suspended_from?, suspended_until? } }.
 */
export function suspensionTimes(fromInput, untilInput) {
  const from = timeToApi(fromInput);
  const until = timeToApi(untilInput);
  const errors = {};
  if (from.error) errors.suspended_from = from.error;
  if (until.error) errors.suspended_until = until.error;
  if (!from.error && !until.error) {
    if (from.value && !until.value) errors.suspended_until = END_REQUIRED_MESSAGE;
    else if (until.value && !from.value) errors.suspended_from = START_REQUIRED_MESSAGE;
    else if (from.value && until.value && minutes(until.value) <= minutes(from.value)) errors.suspended_until = END_AFTER_START_MESSAGE;
  }
  return { from: from.value, until: until.value, errors };
}

/**
 * The messages for fields the form has no input for (details keys not in `shown`), so none is lost: they go in the form's banner.
 * `details` is the API's { field: message } object.
 */
export function unmatchedErrorMessages(details, shown) {
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details)
    .filter(([field, message]) => !shown.includes(field) && typeof message === 'string' && message.trim() !== '')
    .map(([, message]) => message.trim());
}
