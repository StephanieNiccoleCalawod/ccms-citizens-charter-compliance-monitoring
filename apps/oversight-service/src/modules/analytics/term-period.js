import { AppError, Errors } from 'ccms-shared';
import { coreBaseUrl } from '../reports/names.js';

// S8-64: an academic term or a whole school year as a period. The term list is Core's read-only copy of what SMS sends
// (GET /api/terms/sms; the local /api/terms list when SMS is off). A chosen term or school year becomes a plain from/to custom
// range, so every figure is exactly what the same dates give as a custom range, and the report table needs no new period type.
// The label travels beside the dates (period_label); a published report keeps both, so a later SMS correction never changes it.
const unavailable = () => new AppError(503, 'TERMS_UNAVAILABLE', 'The academic terms could not be loaded right now. Please try again in a few minutes.');
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Terms with usable dates, as { code, name, schoolYear, from, to }. */
export function normalizeTerms(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((t) => ({
    code: text(t.term_code) ?? text(t.term_id),
    name: text(t.term_name) ?? text(t.term_code),
    schoolYear: text(t.academic_year),
    from: text(t.start_date)?.slice(0, 10) ?? null,
    to: text(t.end_date)?.slice(0, 10) ?? null,
  })).filter((t) => t.code && t.from && t.to && t.from <= t.to);
}

/** { from, to, label, kind } for one term (by code) or one school year (all its terms), or throws a plain 400. */
export function pickTermPeriod(terms, { term, schoolYear }) {
  if (term && schoolYear) throw Errors.validation('Choose either an academic term or a school year, not both.', { term: 'Choose either an academic term or a school year, not both.' });
  if (term) {
    const found = terms.find((t) => t.code === term);
    if (!found) throw Errors.validation('That academic term was not found. Choose another one.', { term: 'That academic term was not found. Choose another one.' });
    return { kind: 'term', from: found.from, to: found.to, label: found.schoolYear ? `${found.name}, School Year ${found.schoolYear}` : found.name };
  }
  const inYear = terms.filter((t) => t.schoolYear === schoolYear);
  if (!inYear.length) throw Errors.validation('That school year was not found. Choose another one.', { school_year: 'That school year was not found. Choose another one.' });
  return {
    kind: 'school_year',
    from: inYear.map((t) => t.from).sort()[0],
    to: inYear.map((t) => t.to).sort().at(-1),
    label: `School Year ${schoolYear}`,
  };
}

async function readTerms({ authorization, env, fetchImpl }) {
  const base = coreBaseUrl(env);
  if (!base) throw unavailable();
  const get = async (path) => {
    let response;
    try { response = await fetchImpl(`${base}${path}`, { headers: { accept: 'application/json', authorization }, signal: AbortSignal.timeout(5000) }); } catch { throw unavailable(); }
    if (!response.ok) throw unavailable();
    try { return await response.json(); } catch { throw unavailable(); }
  };
  const sms = await get('/terms/sms');
  if (sms?.enabled) {
    if (sms.state !== 'OK') throw unavailable();
    return normalizeTerms(sms);
  }
  return normalizeTerms(await get('/terms'));
}

/**
 * The query a route should use: when `term` or `school_year` is given it is replaced by period=custom with the term's dates and
 * a `period_label`; any `period_label` the caller sent is dropped. Without either, the query is returned as a plain copy.
 */
export async function resolveTermQuery(query, { authorization, env = process.env, fetchImpl = fetch } = {}) {
  const entries = typeof query?.entries === 'function' ? Object.fromEntries(query.entries()) : { ...(query ?? {}) };
  delete entries.period_label;
  const term = text(entries.term);
  const schoolYear = text(entries.school_year);
  if (!term && !schoolYear) return { query: entries, label: null };
  if (entries.from || entries.to) throw Errors.validation('Choose a term or a school year, or your own dates, not both.', { from: 'Choose a term or a school year, or your own dates, not both.' });
  const picked = pickTermPeriod(await readTerms({ authorization, env, fetchImpl }), { term, schoolYear });
  delete entries.term; delete entries.school_year;
  return { query: { ...entries, period: 'custom', from: picked.from, to: picked.to }, label: picked.label };
}
