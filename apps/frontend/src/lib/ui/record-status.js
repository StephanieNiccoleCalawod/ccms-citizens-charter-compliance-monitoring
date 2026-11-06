// One rule for records that are no longer active (offices, services, counters ...) wherever they are offered in a dropdown.
// The API says it with the boolean `is_active`. Only `true` is active; `false` is inactive; anything else (missing, null, a
// string ...) is "unknown" and is never treated as active. The name is never inspected: "(Inactive)" is only ever added to it.

export const INACTIVE_SUFFIX = '(Inactive)';
export const UNKNOWN_SUFFIX = '(Status unknown)';

/** 'active' | 'inactive' | 'unknown' */
export function recordState(record) {
  if (record?.is_active === true) return 'active';
  if (record?.is_active === false) return 'inactive';
  return 'unknown';
}

/** Only an active record can be newly chosen. */
export const isSelectable = (record) => recordState(record) === 'active';

/** The label with "(Inactive)" (or "(Status unknown)") added once; an active record's label is unchanged. */
export function statusLabel(label, record) {
  const text = String(label ?? '');
  const state = recordState(record);
  if (state === 'active') return text;
  const suffix = state === 'inactive' ? INACTIVE_SUFFIX : UNKNOWN_SUFFIX;
  return text.toLowerCase().endsWith(suffix.toLowerCase()) ? text : `${text} ${suffix}`;
}

/**
 * A SearchableSelect option for a record: the label gets the suffix, the option is `disabled` unless active.
 * `extra` is any other option fields (secondary, search).
 */
export function recordOption(record, value, label, extra = {}) {
  return { value, label: statusLabel(label, record), disabled: !isSelectable(record), ...extra };
}
