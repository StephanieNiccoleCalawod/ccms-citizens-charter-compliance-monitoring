// Flow 2 (reader only): the academic terms SMS owns. GET {SMS origin}/api/v1/terms with `Authorization: Bearer <SMS key>`.
// Off unless SMS_TERMS_ENABLED=true. Nothing is stored here. With the switch on, the Academic terms tab shows these terms,
// read-only (the PM decided that SMS owns the terms, 11/06/2026), and Core refuses to add or edit its own terms.
//
// The reply shape below is what the SCMS code supplied returns: { statusCode, count, data: [term] } with term_code,
// academic_year, semester_number, semester_label, display_label, start_date, end_date, status.
// WARNING: in that code GET /api/v1/terms accepts only a signed-in SCMS user's token, not a machine key. Until SMS adds a
// machine-key check for the read:terms scope, this call is answered with 401.
import { smsTermCode } from './sms-snapshot.js';

export const termsEnabled = (env = process.env) => String(env.SMS_TERMS_ENABLED ?? '').toLowerCase() === 'true';

export function normalizeTerm(term) {
  return {
    termCode: smsTermCode(term.term_code) ?? term.term_code,
    academicYear: term.academic_year ?? null,
    semesterNumber: term.semester_number ?? null,
    semesterLabel: term.semester_label ?? null,
    displayLabel: term.display_label ?? null,
    startDate: String(term.start_date ?? '').slice(0, 10) || null,
    endDate: String(term.end_date ?? '').slice(0, 10) || null,
    status: term.status ?? null,
  };
}

/** Reads the terms. Returns { skipped, reason } when off or not configured; throws on a 401 (KEY_REJECTED) or another failure. */
export async function fetchSmsTerms({ env = process.env, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!termsEnabled(env)) return { skipped: true, reason: 'SMS_TERMS_ENABLED is not true', terms: [] };
  const base = (env.SMS_URL || env.AUDIT_URL || '').trim();
  const token = (env.SMS_SERVICE_TOKEN || env.SMS_CALENDAR_TOKEN || '').trim();
  if (!base || !token) return { skipped: true, reason: 'SMS_URL and the SMS key are required', terms: [] };
  const response = await fetchImpl(`${new URL(base).origin}/api/v1/terms`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401) throw Object.assign(new Error('KEY_REJECTED: SMS refused our key (401)'), { code: 'KEY_REJECTED' });
  if (!response.ok) throw new Error(`SMS responded ${response.status}`);
  const body = await response.json();
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  return { skipped: false, terms: list.map(normalizeTerm) };
}

/** Fixed text for a term the Terms tab shows: the screen never prints anything the service sent besides these fields. */
export function toTermRow(term) {
  return {
    term_code: term.termCode,
    term_name: term.displayLabel || term.termCode,
    start_date: term.startDate,
    end_date: term.endDate,
    status: term.status,
  };
}

/**
 * What GET /terms/sms answers (the Academic terms tab). enabled=false: the tab keeps its own list. Otherwise state is one of
 * OK, NOT_CONFIGURED, KEY_REJECTED, UNAVAILABLE; no error text from SMS is passed on.
 */
export async function readTermsForScreen({ env = process.env, fetchImpl = fetch } = {}) {
  if (!termsEnabled(env)) return { enabled: false, state: 'OFF', items: [] };
  try {
    const result = await fetchSmsTerms({ env, fetchImpl });
    if (result.skipped) return { enabled: true, state: 'NOT_CONFIGURED', items: [] };
    return { enabled: true, state: 'OK', items: result.terms.map(toTermRow).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))) };
  } catch (error) {
    return { enabled: true, state: error?.code === 'KEY_REJECTED' ? 'KEY_REJECTED' : 'UNAVAILABLE', items: [] };
  }
}
