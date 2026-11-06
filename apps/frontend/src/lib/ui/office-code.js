// Rules for office codes and the institution prefix (CC006, "PUP-OSAS"), as pure functions so they can be tested directly.
// The Core service owns the real rules. It keeps the institution code (GET and PUT /api/catalogue/catalogue-settings), and it BUILDS
// the office code itself: a create or edit sends the office part as office_abbr (not a full office_code, which it rejects), and Core
// answers with the full code "INSTITUTION-PART". Core keeps it unique in any letter case and at most 20 characters, and refuses to
// change the institution code once it is set. Nothing here changes a code in the data: it shows the full code as a preview, checks
// the office part early, and explains the service's answers.

export const OFFICE_CODE_MAX = 20;
export const OFFICE_PART_PATTERN = /^[A-Z0-9]+$/;
export const OFFICE_PART_MESSAGE = 'The office part can only have letters and digits (no spaces or symbols).';
export const INSTITUTION_NOT_CONFIGURED_MESSAGE = 'The institution code has not been set yet. A Super Admin must set it first.';
export const INSTITUTION_IMMUTABLE_MESSAGE = 'The institution code cannot be changed once it is set.';
export const INSTITUTION_UNAVAILABLE_MESSAGE = 'The institution code could not be loaded, so offices cannot be added or edited right now.';
export const CODE_TAKEN_MESSAGE = 'Office code already exists';
export const NAME_TAKEN_MESSAGE = 'Office name already exists';
export const INSTITUTION_CODE_MESSAGE = 'Institution code must be 2 to 10 uppercase letters or digits (for example PUP).';
export const FORBIDDEN_MESSAGE = 'You do not have permission to change offices. Ask a Super Admin.';
export const SERVER_ERROR_MESSAGE = 'The server could not save this office right now. Please try again in a few minutes.';

/** Error text for an institution code that is not 2-10 uppercase letters or digits, or null when it is fine. */
export function institutionCodeProblem(code) {
  return /^[A-Z0-9]{2,10}$/.test(String(code ?? '').trim()) ? null : INSTITUTION_CODE_MESSAGE;
}

/** The full office code from the fixed prefix and what the person typed: "PUP" + "OSAS" -> "PUP-OSAS". No prefix: just the code. */
export function composeOfficeCode(prefix, part) {
  const text = String(part ?? '').trim();
  return prefix ? `${prefix}-${text}` : text;
}

/** True when a stored code already starts with the prefix and a hyphen (any letter case). */
export function hasPrefix(prefix, code) {
  return Boolean(prefix) && String(code ?? '').toUpperCase().startsWith(`${String(prefix).toUpperCase()}-`);
}

/**
 * What the office part of a stored code is, for the Edit form: "PUP-OSAS" -> "OSAS", so saving never
 * writes "PUP-PUP-OSAS". A code without the prefix (an office that has not been re-coded yet) has no
 * separate part: returns null and the form shows the whole code as it is.
 */
export function officePart(prefix, code) {
  const text = String(code ?? '');
  return hasPrefix(prefix, text) ? text.slice(String(prefix).length + 1) : null;
}

/** Early feedback on the office part; Core checks again. Resolves to a message or null. */
export function officeCodeProblem(prefix, part) {
  const text = String(part ?? '').trim();
  if (!text) return 'Enter the office part, for example OSAS.';
  if (!OFFICE_PART_PATTERN.test(text.toUpperCase())) return OFFICE_PART_MESSAGE;
  const full = composeOfficeCode(prefix, text);
  if (full.length > OFFICE_CODE_MAX) {
    const room = prefix ? Math.max(0, OFFICE_CODE_MAX - String(prefix).length - 1) : OFFICE_CODE_MAX;
    return `The full code "${full}" is ${full.length} characters. Office codes can be at most ${OFFICE_CODE_MAX} characters including the hyphen, so the office part can be at most ${room}.`;
  }
  return null;
}

/**
 * A failed office save as { fieldErrors, message }: field messages go under their inputs (the form's "office_code" field is the
 * office part), message in the form's banner. Core's answers: 409 OFFICE_CODE_EXISTS / OFFICE_NAME_EXISTS (details by field),
 * 409 OFFICE_CODE_CHANGE_NEEDS_DECISION (details.office_abbr), 409 INSTITUTION_NOT_CONFIGURED, 400 with details.office_abbr or
 * office_name, and 403.
 */
export function officeSaveError(err, prefix = null) {
  const status = err?.status;
  const details = err?.details && typeof err.details === 'object' ? err.details : null;
  const fieldErrors = {};
  const limit = prefix ? `, so the office part can be at most ${OFFICE_CODE_MAX - prefix.length - 1}` : '';
  if (status === 409 && err.code === 'INSTITUTION_NOT_CONFIGURED') return { fieldErrors, message: INSTITUTION_NOT_CONFIGURED_MESSAGE };
  if (status === 409 && err.code === 'OFFICE_CODE_CHANGE_NEEDS_DECISION') {
    fieldErrors.office_code = details?.office_abbr ?? err.message;
    return { fieldErrors, message: err.message };
  }
  if (status === 409) {
    if (err.code === 'OFFICE_NAME_EXISTS' && !details?.office_code) fieldErrors.office_name = NAME_TAKEN_MESSAGE;
    else fieldErrors.office_code = CODE_TAKEN_MESSAGE;
    if (details?.office_name) fieldErrors.office_name = NAME_TAKEN_MESSAGE;
    return { fieldErrors, message: null };
  }
  if (status === 400 && details) {
    const codeProblem = details.office_abbr ?? details.office_code;
    if (codeProblem) {
      fieldErrors.office_code = /20 characters/.test(String(codeProblem))
        ? `Office codes can be at most ${OFFICE_CODE_MAX} characters including the institution code and the hyphen${limit}.`
        : String(codeProblem);
    }
    if (details.office_name) fieldErrors.office_name = String(details.office_name);
    if (details.institution_code) fieldErrors.institution_code = INSTITUTION_CODE_MESSAGE;
    if (Object.keys(fieldErrors).length) return { fieldErrors, message: null };
  }
  if (status === 403) return { fieldErrors, message: FORBIDDEN_MESSAGE };
  if (err?.code === 'NETWORK_ERROR') return { fieldErrors, message: err.message };
  if (status >= 500) return { fieldErrors, message: SERVER_ERROR_MESSAGE };
  return { fieldErrors, message: err?.message ?? 'Something went wrong. Please try again.' };
}

/** The body Core expects for an office create or edit: the office part as office_abbr (Core upper-cases it and builds the full code). */
export function officeRequestBody(part, officeName) {
  return { office_abbr: String(part ?? '').trim().toUpperCase(), office_name: officeName };
}

/** The institution-code save error as { fieldErrors, message }. */
export function institutionSaveError(err) {
  const status = err?.status;
  if (status === 400 && err?.details?.institution_code) return { fieldErrors: { institution_code: INSTITUTION_CODE_MESSAGE }, message: null };
  if (status === 409 && err?.code === 'INSTITUTION_CODE_IMMUTABLE') return { fieldErrors: { institution_code: INSTITUTION_IMMUTABLE_MESSAGE }, message: null };
  if (status === 403) return { fieldErrors: {}, message: FORBIDDEN_MESSAGE };
  if (err?.code === 'NETWORK_ERROR') return { fieldErrors: {}, message: err.message };
  if (status >= 500) return { fieldErrors: {}, message: SERVER_ERROR_MESSAGE };
  return { fieldErrors: {}, message: err?.message ?? 'Something went wrong. Please try again.' };
}
