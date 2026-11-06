// Flow 2 (reader only): the academic terms SMS owns. GET {SMS origin}/api/v1/terms with `Authorization: Bearer <SMS key>`.
// Off unless SMS_TERMS_ENABLED=true. Nothing is stored here: caching into the term list waits for the PM's decision on who
// owns terms (Decisions Log H14), because our term list has no term code, academic year or semester fields yet.
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
