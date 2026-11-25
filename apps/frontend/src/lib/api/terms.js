// The academic terms for the period selectors (S8-64): GET /api/calendar/terms/sms (the Syllabus Management System copy) and, when SMS
// is off, GET /api/calendar/terms (the local list). A failure gives no terms, so the selector greys the choices out instead of breaking.
import { apiFetch } from '../auth/session.js';
import { parseTerms } from '../ui/term-period.js';

export async function loadTerms(fetcher = apiFetch) {
  try {
    const sms = await fetcher('/api/calendar/terms/sms', { background: true });
    if (sms?.enabled) return sms.state === 'OK' ? parseTerms(sms) : [];
    return parseTerms(await fetcher('/api/calendar/terms', { background: true }));
  } catch {
    return [];
  }
}
