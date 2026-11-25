// S8-47 / S8-48: what the Expected Requests section says, built only from the forecast the service sent. Nothing is estimated here:
// the headline adds up the five forecast points the service already gave, the day cards show those points, and the table lists the
// recorded days the model used followed by the expected days.
import { formatDate, formatDateAxis, formatDateLong, formatDateRange, formatDateShort } from './date-format.js';

export const FORECAST_NOT_ENOUGH = 'Not enough history yet';
export const FORECAST_CLOSED = 'Office closed';
export const TABLE_PAGE = 25;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const whole = (value) => (isNumber(value) ? Math.round(value) : null);

function dayOfWeek(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : null;
}

function addDays(date, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const rows = (run) => (Array.isArray(run?.forecast) ? run.forecast.filter((f) => f && dayOfWeek(f.date) !== null) : []);

/**
 * The headline above the chart: 'Expected requests next week: about 64 (likely between 52 and 75), November 24–28, 2026.'
 * null when there is no forecast. The totals are the sums of the five points and of their likely ranges.
 */
export function forecastHeadline(run) {
  const list = rows(run);
  if (run?.status !== 'SUCCESS' || list.length === 0) return null;
  const total = list.reduce((sum, f) => sum + (isNumber(f.point) ? f.point : 0), 0);
  const hasRange = list.every((f) => isNumber(f.lower) && isNumber(f.upper));
  const low = hasRange ? list.reduce((sum, f) => sum + f.lower, 0) : null;
  const high = hasRange ? list.reduce((sum, f) => sum + f.upper, 0) : null;
  const period = formatDateRange(list[0].date, list.at(-1).date);
  const range = hasRange ? ` (likely between ${whole(low)} and ${whole(high)})` : '';
  return { total: whole(total), low: whole(low), high: whole(high), period, text: `Expected requests next week: about ${whole(total)}${range}, ${period}.` };
}

/**
 * The day cards: one per forecast working day (weekday, full date, expected count), plus a closed card for each weekday between the
 * first and last forecast day that the calendar left out (a holiday or a suspension of work).
 */
export function forecastDayCards(run) {
  const list = rows(run);
  if (list.length === 0) return [];
  const byDate = new Map(list.map((f) => [f.date, f]));
  const cards = [];
  for (let date = list[0].date; date <= list.at(-1).date; date = addDays(date, 1)) {
    const dow = dayOfWeek(date);
    const f = byDate.get(date);
    if (f) cards.push({ date, weekday: WEEKDAYS[dow], dateText: formatDateLong(date), closed: false, expected: whole(f.point), lower: whole(f.lower), upper: whole(f.upper) });
    else if (dow >= 1 && dow <= 5) cards.push({ date, weekday: WEEKDAYS[dow], dateText: formatDateLong(date), closed: true, expected: null, lower: null, upper: null });
  }
  return cards;
}

/** 'Over the last 5 working days this method was off by about 3 requests per day on average.' null when no error was measured. */
export function accuracyLine(run) {
  const mae = run?.model?.mae;
  if (!isNumber(mae)) return null;
  const rounded = Math.round(mae * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `Over the last 5 working days this method was off by about ${text} request${rounded === 1 ? '' : 's'} per day on average.`;
}

/** The message when the forecast cannot be shown yet, in words with the real numbers. null when a forecast exists. */
export function notEnoughHistoryMessage(run) {
  if (!run || run.status === 'SUCCESS') return null;
  if (run.status === 'NOT_ENOUGH_HISTORY') {
    const days = Number(run.historyWorkingDays) || 0;
    return `${FORECAST_NOT_ENOUGH}. A forecast needs at least 20 working days of requests${days > 0 ? `; ${days} ${days === 1 ? 'day is' : 'days are'} recorded so far` : ''}.`;
  }
  if (run.status === 'TOO_FEW') return `${FORECAST_NOT_ENOUGH} for this service. A service forecast needs at least 40 requests on record.`;
  return null;
}

/**
 * Every row the model used, then the expected days, for the table and the CSV:
 * { date, dateText, kind: 'Recorded' | 'Expected', actual, expected, range }.
 */
export function forecastTableRows(run) {
  const history = (Array.isArray(run?.history) ? run.history : []).filter((h) => h && dayOfWeek(h.date) !== null)
    .map((h) => ({ date: h.date, dateText: formatDateShort(h.date), kind: 'Recorded', actual: isNumber(h.count) ? h.count : null, expected: null, range: '' }));
  const future = rows(run).map((f) => ({
    date: f.date, dateText: formatDateShort(f.date), kind: 'Expected', actual: null, expected: whole(f.point),
    range: isNumber(f.lower) && isNumber(f.upper) ? `${whole(f.lower)}–${whole(f.upper)}` : '',
  }));
  return [...history, ...future];
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The same rows as the table, as CSV: plain column names, dates MM/DD/YYYY, one header row, UTF-8 with a byte-order mark. */
export function forecastCsv(run) {
  const header = ['Date', 'Actual requests', 'Expected requests', 'Likely range', 'Type'];
  const lines = forecastTableRows(run).map((r) => [formatDate(r.date), r.actual ?? '', r.expected ?? '', r.range, r.kind]);
  return `﻿${[header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The chart's points: recorded days then expected days, with the axis label ('Nov 24') and the full date for the tooltip. */
export function forecastChartData(run) {
  const history = (Array.isArray(run?.history) ? run.history : []).map((h) => ({
    date: h.date, label: formatDateAxis(h.date), fullDate: formatDateLong(h.date), actual: h.count, forecast: null, lower: null, upper: null,
  }));
  const future = rows(run).map((f) => ({
    date: f.date, label: formatDateAxis(f.date), fullDate: formatDateLong(f.date), actual: null, forecast: f.point, lower: f.lower, upper: f.upper,
  }));
  return [...history, ...future];
}

/** The file name of the table download. */
export function forecastCsvName(officeName, today) {
  const clean = String(officeName || 'All_offices').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'All_offices';
  const day = formatDate(today).replaceAll('/', '');
  return `CCCMS_Expected_Requests_${clean}${day ? `_${day}` : ''}.csv`;
}
