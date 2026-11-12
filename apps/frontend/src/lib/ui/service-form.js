// Rules for the Add / Edit Service form, as pure functions (no React, no network), so they can be tested directly.
// The Core service checks everything again; this gives early feedback by field, builds the request the service
// expects, and maps the service's field errors back onto the form.
import { procedureFields, procedureForBody, procedureProblem } from './procedure-steps.js';

export const WHO_MAY_AVAIL_MAX = 1000;
export const ABBR_REQUIRED_MESSAGE = 'Enter the service abbreviation (2 to 5 letters or digits, for example TOR).';
export const ABBR_MESSAGE = 'Service abbreviation must be 2 to 5 letters or digits (A to Z, 0 to 9), with no spaces or symbols.';
export const PREVIEW_NO_OFFICE_MESSAGE = 'Select an office to see the service code.';
export const PERMISSION_MESSAGE = 'You do not have permission to add or change services. Ask a Super Admin.';
export const PREVIEW_UNAVAILABLE_MESSAGE = 'The service code could not be previewed right now. The system still assigns it when you save.';
export const FEES_MAX = 500;
export const NAME_MIN = 3;
export const NAME_MAX = 200;
export const CHARTER_REFERENCE_MAX = 200;
export const DOCUMENT_NAME_MAX = 250;
export const DOCUMENT_NOTES_MAX = 1000;
export const ABBR_PATTERN = /^[A-Z0-9]{2,5}$/;
const PART_MAX = 1000000;
const PART_LIMITS = { duration_days: PART_MAX, duration_hours: 23, duration_minutes: 59 }; // hours within a day, minutes within an hour

export const EMPTY_SERVICE_FORM = {
  office_id: '',
  service_abbr: '',
  abbr_edited: false, // true once the person typed the abbreviation themselves: the name no longer suggests one
  service_code: '', // read-only: only ever filled from a saved service
  service_name: '',
  classification: 'SIMPLE',
  service_scope: 'EXTERNAL',
  transaction_types: [],
  // Procedure: processing_steps is the text; procedure_mode/procedure_steps are the step editor's view of it
  // (the editor is used only when the stored text round-trips exactly, see lib/ui/procedure-steps.js).
  processing_steps: '',
  procedure_mode: 'steps',
  procedure_steps: [],
  fees: '',
  who_may_avail: '',
  // CC047: who may start this service; at least one. New services allow all four.
  allowed_client_types: ['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL'],
  duration_days: '0',
  duration_hours: '0',
  duration_minutes: '0',
  effective_from: '',
  charter_reference: '',
  documents: [], // required documents saved with a NEW service: { document_name, is_mandatory, notes }
};

/** The form for a saved service. Every editable field starts from what is stored, so an edit never blanks another one. */
export function serviceToForm(service) {
  return {
    ...EMPTY_SERVICE_FORM,
    office_id: service.office_id,
    service_code: service.service_code ?? '',
    service_name: service.service_name,
    classification: service.classification,
    service_scope: service.service_scope ?? EMPTY_SERVICE_FORM.service_scope,
    transaction_types: Array.isArray(service.transaction_types) ? [...service.transaction_types] : [],
    ...procedureFields(service.processing_steps),
    fees: service.fees ?? '',
    who_may_avail: service.who_may_avail ?? '',
    // An older Core without the field: all four (what it enforces). Kept as stored otherwise.
    allowed_client_types: Array.isArray(service.allowed_client_types) ? [...service.allowed_client_types] : [...EMPTY_SERVICE_FORM.allowed_client_types],
  };
}

/** CC047: the client-type checkboxes, in the canonical order. */
export const ALLOWED_CLIENT_TYPE_OPTIONS = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'ALUMNI', label: 'Alumni' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'EXTERNAL', label: 'External' },
];
/** Toggles one type, keeping the canonical order. */
export function toggleClientType(list, value) {
  const next = list.includes(value) ? list.filter((t) => t !== value) : [...list, value];
  return ALLOWED_CLIENT_TYPE_OPTIONS.map((t) => t.value).filter((t) => next.includes(t));
}

// ---- Required documents on the Add Service form ----
export const addDocumentRow = (documents) => [...documents, { document_name: '', is_mandatory: true, notes: '' }];
export const removeDocumentRow = (documents, index) => documents.filter((_, i) => i !== index);
export const setDocumentRow = (documents, index, patch) => documents.map((doc, i) => (i === index ? { ...doc, ...patch } : doc));
const documentKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The first problem in the documents list as one message that names the row, or null. */
export function documentsProblem(documents) {
  const seen = new Set();
  for (const [index, doc] of (documents ?? []).entries()) {
    const label = `Document ${index + 1}`;
    const name = String(doc.document_name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return `${label}: enter the document name, or remove the row.`;
    if (name.length > DOCUMENT_NAME_MAX) return `${label}: the name must be ${DOCUMENT_NAME_MAX} characters or fewer.`;
    if (/[<>"`]/.test(name)) return `${label}: the name cannot contain < > " or \` characters.`;
    if (String(doc.notes ?? '').length > DOCUMENT_NOTES_MAX) return `${label}: notes must be ${DOCUMENT_NOTES_MAX} characters or fewer.`;
    if (seen.has(documentKey(name))) return `${label}: this service already has a document with this name.`;
    seen.add(documentKey(name));
  }
  return null;
}

const blank = (text) => String(text ?? '').trim() === '';

/**
 * Request body for POST (isNew: with abbreviation and first standard) or PUT (without). The service code is never
 * sent: the server generates it on create and keeps it on edit, also when the service moves to another office.
 * Who may avail is sent exactly as typed (line breaks included); a blank one is null.
 */
export function formToBody(form, isNew) {
  const body = {
    office_id: form.office_id,
    service_name: form.service_name,
    classification: form.classification,
    service_scope: form.service_scope,
    transaction_types: [...form.transaction_types],
    // Step editor: the numbered text. Text box: exactly what is in it. Empty is no procedure.
    processing_steps: procedureForBody(form),
    fees: blank(form.fees) ? null : form.fees,
    who_may_avail: blank(form.who_may_avail) ? null : form.who_may_avail,
    allowed_client_types: [...form.allowed_client_types],
  };
  if (isNew) {
    body.service_abbr = form.service_abbr.trim().toUpperCase();
    body.standard = standardToBody(form);
    // Names only. Every row has a name (validated before sending); the notes are optional.
    body.documents = (form.documents ?? []).map((doc) => ({ document_name: doc.document_name, is_mandatory: doc.is_mandatory !== false, notes: doc.notes?.trim() ? doc.notes : null }));
  }
  return body;
}

/** The three parts of a processing standard plus its date and Charter reference, as the service wants them. */
export function standardToBody(values) {
  return {
    duration_days: toPart(values.duration_days),
    duration_hours: toPart(values.duration_hours),
    duration_minutes: toPart(values.duration_minutes),
    effective_from: values.effective_from,
    charter_reference: values.charter_reference,
  };
}

const isWhole = (text) => /^\d+$/.test(String(text).trim());
const toPart = (text) => (isWhole(text) ? Number(String(text).trim()) : NaN);

/** Early feedback on the three duration parts and the group as a whole. Returns { duration_days, ..., duration }. */
export function durationErrors(values) {
  const errors = {};
  const parts = [
    ['duration_days', 'Working days'],
    ['duration_hours', 'Hours'],
    ['duration_minutes', 'Minutes'],
  ];
  for (const [name, label] of parts) {
    const n = toPart(values[name]);
    if (!isWhole(values[name]) || n > PART_LIMITS[name]) {
      errors[name] = name === 'duration_days' ? `${label} must be a whole number of 0 or more.` : `${label} must be a whole number from 0 to ${PART_LIMITS[name]}.`;
    }
  }
  if (Object.keys(errors).length === 0 && parts.every(([name]) => toPart(values[name]) === 0)) {
    errors.duration = 'Enter at least one of working days, hours or minutes (more than 0).';
  }
  return errors;
}

/** Early feedback for the whole form, by field. Empty when it can be sent. */
export function validateServiceForm(form, isNew) {
  const errors = {};
  if (blank(form.office_id)) errors.office_id = 'Select an office.';
  if (isNew) {
    const problem = abbreviationProblem(form.service_abbr);
    if (problem) errors.service_abbr = problem;
  }
  const name = form.service_name.replace(/\s+/g, ' ').trim();
  if (!name) errors.service_name = 'Enter the service name.';
  else if (name.length < NAME_MIN || name.length > NAME_MAX) errors.service_name = `Service name must be ${NAME_MIN} to ${NAME_MAX} characters.`;
  else if (/[<>"`]/.test(name)) errors.service_name = 'Service name cannot contain < > " or ` characters.';
  if (!form.classification) errors.classification = 'Select the service type.';
  if (!form.service_scope) errors.service_scope = 'Select Internal or External.';
  if (form.transaction_types.length === 0) errors.transaction_types = 'Select at least one transaction type.';
  if (form.fees.length > FEES_MAX) errors.fees = `Fees must be ${FEES_MAX} characters or fewer.`;
  if (form.who_may_avail.length > WHO_MAY_AVAIL_MAX) errors.who_may_avail = `Who may avail must be ${WHO_MAY_AVAIL_MAX} characters or fewer.`;
  if (!Array.isArray(form.allowed_client_types) || form.allowed_client_types.length === 0) errors.allowed_client_types = 'Select at least one client type.';
  const procedure = procedureProblem(form);
  if (procedure) errors.processing_steps = procedure;
  if (isNew) {
    const documents = documentsProblem(form.documents);
    if (documents) errors.documents = documents;
    Object.assign(errors, durationErrors(form));
    if (blank(form.effective_from)) errors.effective_from = 'Enter the date the standard starts.';
    const reference = form.charter_reference.replace(/\s+/g, ' ').trim();
    // The Charter reference is optional: empty is fine, only a too-long one is a problem.
    if (reference.length > CHARTER_REFERENCE_MAX) errors.charter_reference = `Charter reference must be ${CHARTER_REFERENCE_MAX} characters or fewer.`;
  }
  return errors;
}

/** Remaining characters for a limited text box (negative when over). */
export const charsLeft = (text, max) => max - String(text ?? '').length;

/**
 * The service's field errors (keys such as "standard.duration_days" or "service_abbr") as form field errors.
 * Returns { fields, other }: fields keyed by form field name, and other = messages for keys no field shows
 * (kept so they are still shown to the person).
 */
export function mapServiceErrors(details, shownFields, { isNew = false } = {}) {
  const fields = {};
  const other = [];
  for (const [key, message] of Object.entries(details ?? {})) {
    if (typeof message !== 'string') continue;
    // A problem in one document row ("documents.1.document_name") is shown under the Required documents list with its row number.
    const row = /^documents\.(\d+)\./.exec(key);
    const name = row ? 'documents' : key.startsWith('standard.') ? key.slice('standard.'.length) : key;
    const text = row ? `Document ${Number(row[1]) + 1}: ${message}` : message;
    // The code is generated from the abbreviation, so a "code already exists" answer belongs to the abbreviation field when adding.
    // When editing the code is read-only and has no field, so it stays a general message.
    const field = name === 'officeId' ? 'office_id' : name === 'service_code' && isNew ? 'service_abbr' : name;
    if (shownFields.includes(field) && !fields[field]) fields[field] = text;
    else if (!other.includes(text)) other.push(text);
  }
  return { fields, other };
}

export const SERVICE_FORM_FIELDS = [
  'office_id', 'service_abbr', 'service_name', 'classification', 'service_scope', 'transaction_types', 'processing_steps',
  'fees', 'who_may_avail', 'allowed_client_types', 'documents', 'duration_days', 'duration_hours', 'duration_minutes', 'duration', 'effective_from', 'charter_reference',
];

// ---- Service code built by the system (CC007) ----
// Core builds the code "{OFFICE_CODE}-{ABBR}-{NNN}" and numbers it; the form only sends the abbreviation (service_abbr) and shows
// Core's preview (GET /services/next-code?officeId=&abbr=). Nothing here builds, numbers or guesses a code.

/** Early feedback on the abbreviation (what Core accepts: 2 to 5 uppercase letters or digits; lower case is turned into upper case). */
export function abbreviationProblem(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return ABBR_REQUIRED_MESSAGE;
  return ABBR_PATTERN.test(text) ? null : ABBR_MESSAGE;
}

/**
 * A suggestion for the abbreviation from the service name: the first letter (or digit) of each word, so "Transcript of Records" is
 * TOR. More than five words give the first five initials. A name that gives fewer than two initials (one word) suggests the first
 * three letters of that word; nothing usable gives "". It is only a suggestion: the person can type any other abbreviation.
 */
export function suggestAbbreviation(name) {
  const words = String(name ?? '')
    .split(/[\s\-/]+/)
    .map((word) => word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  const initials = words.map((word) => word[0].toUpperCase()).join('');
  if (initials.length >= 2) return initials.slice(0, 5);
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 3).toUpperCase();
  return '';
}

/**
 * What the code preview can do for an office and an abbreviation: { state: 'no_office' | 'invalid', message } when no request is
 * made, or { state: 'ready', path } with the request to make (path after /api/catalogue). Core wants the office id and the abbreviation.
 */
export function previewPlan(officeId, abbreviation) {
  if (!officeId) return { state: 'no_office', message: PREVIEW_NO_OFFICE_MESSAGE };
  const problem = abbreviationProblem(abbreviation);
  if (problem) return { state: 'invalid', message: problem };
  const abbr = String(abbreviation).trim().toUpperCase();
  return { state: 'ready', path: `/services/next-code?officeId=${encodeURIComponent(officeId)}&abbr=${encodeURIComponent(abbr)}` };
}

/** A failed preview as one readable message (never a code). */
export function previewErrorMessage(err) {
  const status = err?.status;
  const details = err?.details && typeof err.details === 'object' ? err.details : null;
  if (status === 403) return PERMISSION_MESSAGE;
  if (status === 400 && (details?.service_abbr || details?.officeId)) return String(details.service_abbr ?? details.officeId);
  if (status === 404) return 'This office could not be found or is no longer active.';
  if (status === 409 && (details?.service_abbr || err?.message)) return String(details?.service_abbr ?? err.message);
  if (err?.code === 'NETWORK_ERROR') return err.message;
  return PREVIEW_UNAVAILABLE_MESSAGE;
}

/**
 * A failed service save as { details, message }: Core's field errors for the form (service_code clashes are shown under the
 * abbreviation, see mapServiceErrors) and one banner message. 403, network and server failures get safe messages.
 */
export function serviceSaveError(err) {
  const status = err?.status;
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  if (status === 403) return { details: {}, message: PERMISSION_MESSAGE };
  if (err?.code === 'NETWORK_ERROR') return { details: {}, message: err.message };
  if (status >= 500) return { details: {}, message: 'The service could not be saved right now. Please try again in a few minutes.' };
  if (status === 404 && err?.code === 'OFFICE_NOT_FOUND') return { details: { office_id: err.message }, message: err.message };
  return { details, message: err?.message ?? 'The service could not be saved. Please try again.' };
}
