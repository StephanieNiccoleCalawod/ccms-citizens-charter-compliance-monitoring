import { Errors, isValidManilaDate, toManilaDate } from 'ccms-shared';

// TT3 periods (spec 2.3, K10): weekly, monthly, half-year (the default), annual, or a custom range. Every boundary is a Manila date.
// A week runs Monday to Sunday. A half-year is January-June or July-December. `date` is any day inside the wanted period
// (default today); `from` and `to` alone (the older form of the KPI route) mean a custom range.
export const PERIOD_TYPES = Object.freeze(['weekly', 'monthly', 'half_year', 'annual', 'custom']);
export const DEFAULT_PERIOD_TYPE = 'half_year';

const DAY_MS = 86_400_000;
const parse = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const format = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date, days) => format(parse(date) + days * DAY_MS);
const lastDayOfMonth = (year, month) => format(Date.UTC(year, month, 0)); // month is 1-12: day 0 of the next month

/** { type, from, to } for a period type and an anchor Manila date. Throws a 400 for an unknown type or a bad date. */
export function periodBounds(type, anchor) {
  if (!isValidManilaDate(anchor)) throw Errors.validation('Choose a valid date.', { date: 'Choose a valid date.' });
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  if (type === 'weekly') {
    const weekday = new Date(parse(anchor)).getUTCDay(); // 0 Sunday .. 6 Saturday
    const from = addDays(anchor, -((weekday + 6) % 7));
    return { type, from, to: addDays(from, 6) };
  }
  if (type === 'monthly') return { type, from: `${anchor.slice(0, 7)}-01`, to: lastDayOfMonth(year, month) };
  if (type === 'half_year') {
    return month <= 6 ? { type, from: `${year}-01-01`, to: `${year}-06-30` } : { type, from: `${year}-07-01`, to: `${year}-12-31` };
  }
  if (type === 'annual') return { type, from: `${year}-01-01`, to: `${year}-12-31` };
  throw Errors.validation('Choose weekly, monthly, half-year, annual or custom.', { period: 'Choose weekly, monthly, half-year, annual or custom.' });
}

/**
 * Reads a period from query parameters: period (or period_type), date, from, to.
 *   from and/or to given          custom range (both are needed; the older KPI form)
 *   period=custom                  needs from and to
 *   otherwise                      the period type (default half_year) around `date` (default today)
 */
export function resolvePeriod(query, now = new Date()) {
  const get = (name) => (typeof query?.get === 'function' ? query.get(name) : query?.[name]) || undefined;
  const requested = (get('period') ?? get('period_type') ?? '').replace('-', '_') || undefined;
  const from = get('from');
  const to = get('to');
  if (requested && !PERIOD_TYPES.includes(requested)) {
    throw Errors.validation('Choose weekly, monthly, half-year, annual or custom.', { period: 'Choose weekly, monthly, half-year, annual or custom.' });
  }
  if (from || to || requested === 'custom') {
    if (!from || !to || !isValidManilaDate(from) || !isValidManilaDate(to) || from > to) {
      throw Errors.validation('Choose a valid date range.', { from: 'Choose a valid date range.' });
    }
    return { type: 'custom', from, to };
  }
  return periodBounds(requested ?? DEFAULT_PERIOD_TYPE, get('date') ?? toManilaDate(now));
}
