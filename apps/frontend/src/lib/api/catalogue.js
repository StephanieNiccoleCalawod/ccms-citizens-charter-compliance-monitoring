// Catalogue (offices, services, public list) as the browser calls it, through the gateway.
// Everything returned here is plain text or data; pages render it through React (escaped), never as HTML.

export const CATALOGUE_API = '/api/catalogue';
export const OFFICES_API = `${CATALOGUE_API}/offices`;
export const SERVICES_API = `${CATALOGUE_API}/services`;
export const PUBLIC_SERVICES_API = `${CATALOGUE_API}/public/services`;
// Institution code (and the calendar setting): GET for every signed-in role, PUT for Super Admin. Core answers { settings: { institution_code, applies_to_enabled } }.
export const CATALOGUE_SETTINGS_API = `${CATALOGUE_API}/catalogue-settings`;

export const CLASSIFICATIONS = [
  { value: 'SIMPLE', label: 'Simple' },
  { value: 'COMPLEX', label: 'Complex' },
  { value: 'HIGHLY_TECHNICAL', label: 'Highly Technical' },
];
export const SERVICE_SCOPES = [
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'EXTERNAL', label: 'External' },
];
export const TRANSACTION_TYPES = [
  { value: 'G2C', label: 'G2C (Government to Citizen)' },
  { value: 'G2G', label: 'G2G (Government to Government)' },
  { value: 'G2B', label: 'G2B (Government to Business)' },
];

// Longest processing standard (in working days) each service type should have. Going over it only produces a
// warning; the standard is saved exactly as entered.
export const STANDARD_WARNING_DAYS = { SIMPLE: 3, COMPLEX: 7, HIGHLY_TECHNICAL: 20 };

export function classificationLabel(value) {
  return CLASSIFICATIONS.find((c) => c.value === value)?.label ?? value;
}

export function scopeLabel(value) {
  return SERVICE_SCOPES.find((s) => s.value === value)?.label ?? value;
}

/** "G2C, G2B" for a service's transaction_types list (a missing or empty list gives ""). */
export function transactionTypesText(types) {
  return Array.isArray(types) ? types.join(', ') : '';
}

/** "2 working days, 5 hours, 30 minutes": the three parts of a standard, zero parts left out (same wording as the API). */
export function standardText(days, hours, minutes) {
  const parts = [
    [Number(days) || 0, 'working day', 'working days'],
    [Number(hours) || 0, 'hour', 'hours'],
    [Number(minutes) || 0, 'minute', 'minutes'],
  ];
  return parts
    .filter(([value]) => value > 0)
    .map(([value, one, many]) => `${value} ${value === 1 ? one : many}`)
    .join(', ');
}

/**
 * The warning for a standard longer than its service type allows, or null. Working days are compared as they are
 * (never turned into hours): over the limit means more days than the limit, or exactly the limit plus any hours or minutes.
 */
export function standardWarning(classification, days, hours, minutes) {
  const limit = STANDARD_WARNING_DAYS[classification];
  if (limit === undefined) return null;
  const d = Number(days) || 0;
  const extra = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  if (d < limit || (d === limit && extra === 0)) return null;
  return `This processing standard is longer than the usual ${limit} working days for a ${classificationLabel(classification)} service. You can still save it.`;
}
