// S8-64: choose a Dashboard, Home or Report period by academic term or school year. The terms are the read-only copy Core keeps of
// what SMS sends. A choice is one string in the period selector ("term:2026-1S", "year:2026-2027"); the server turns it into the
// term's start and end dates, so the figures equal the same dates chosen as a custom range.
import { formatDateRange } from './date-format.js';

export const TERMS_NOT_AVAILABLE = 'Academic terms are not available yet. They come from the Syllabus Management System.';
const TERM = 'term:';
const YEAR = 'year:';

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Terms with usable dates from Core's answer (the SMS list when it is on, otherwise the local list). */
export function parseTerms(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((t) => ({
    code: text(t.term_code) ?? text(t.term_id),
    name: text(t.term_name) ?? text(t.term_code),
    schoolYear: text(t.academic_year),
    from: text(t.start_date)?.slice(0, 10) ?? null,
    to: text(t.end_date)?.slice(0, 10) ?? null,
  })).filter((t) => t.code && t.from && t.to && t.from <= t.to)
    .sort((a, b) => b.from.localeCompare(a.from));
}

/** { terms: [{value,label}], years: [{value,label}] }. A school year needs the school year to be known. */
export function termChoices(terms) {
  const years = [...new Set(terms.map((t) => t.schoolYear).filter(Boolean))].sort().reverse();
  return {
    terms: terms.map((t) => ({ value: `${TERM}${t.code}`, label: t.schoolYear ? `${t.name} (School Year ${t.schoolYear})` : t.name })),
    years: years.map((y) => ({ value: `${YEAR}${y}`, label: `School Year ${y}` })),
  };
}

export const isTermChoice = (value) => typeof value === 'string' && (value.startsWith(TERM) || value.startsWith(YEAR));

/** The query parts for a period selector value: { period } for the usual ones, { term } or { school_year } for the new ones. */
export function periodParams(value) {
  if (typeof value === 'string' && value.startsWith(TERM)) return { term: value.slice(TERM.length) };
  if (typeof value === 'string' && value.startsWith(YEAR)) return { school_year: value.slice(YEAR.length) };
  return { period: value };
}

/** '1st Semester, School Year 2026–2027 (August 17 – December 2, 2026)', or null when the choice is not a term. */
export function termPeriodText(value, terms) {
  if (!isTermChoice(value)) return null;
  if (value.startsWith(TERM)) {
    const t = terms.find((x) => x.code === value.slice(TERM.length));
    if (!t) return null;
    return `${t.name}${t.schoolYear ? `, School Year ${t.schoolYear.replace('-', '–')}` : ''} (${formatDateRange(t.from, t.to)})`;
  }
  const year = value.slice(YEAR.length);
  const inYear = terms.filter((t) => t.schoolYear === year);
  if (!inYear.length) return null;
  const from = inYear.map((t) => t.from).sort()[0];
  const to = inYear.map((t) => t.to).sort().at(-1);
  return `School Year ${year.replace('-', '–')} (${formatDateRange(from, to)})`;
}
