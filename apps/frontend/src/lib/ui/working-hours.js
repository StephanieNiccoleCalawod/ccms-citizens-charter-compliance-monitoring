// The Working hours screen (campus and office schedules), the parts that are not React: how the "Add working hours" form treats the
// weekday pills and the shared shift, what the "Current schedule" card and the Records say, and the request bodies. Pure functions,
// tested without a browser. The rules themselves (validation, lunch, versions) are in office-schedule.js and are checked again by Core.
import { DAY_SHORT, WEEK_ORDER } from '../api/calendar.js';
import { DEFAULT_CLOSE, DEFAULT_OPEN, time12, toDays, toggleLunch, toggleWorking } from './office-schedule.js';
import { formatDateTime } from './date-format.js';

/** The seven day pills, Monday first. */
export const PILL_DAYS = WEEK_ORDER.map((dow) => ({ dow, label: DAY_SHORT[dow] }));

export const SAVE_NOTE = 'Saving creates a new record. Results already computed won\'t change; only later computations follow this schedule. Times are in Asia/Manila.';

const working = (rows) => rows.filter((r) => r.is_working);

/** The days of an API schedule that are working days. */
export const workingDaySet = (items) => new Set((items ?? []).filter((i) => i.is_working).map((i) => i.day_of_week));

/** The shift most working days share: that of the first working day, or the usual 8:00 AM to 5:00 PM when none is on. */
export function sharedShift(rows) {
  const first = working(rows)[0];
  return { opening_time: first?.opening_time || DEFAULT_OPEN, closing_time: first?.closing_time || DEFAULT_CLOSE };
}

/** The lunch most working days share ({ on, start, end }). */
export function sharedLunch(rows) {
  const first = working(rows)[0];
  return { on: first?.closes_for_lunch === true, start: first?.lunch_start ?? '', end: first?.lunch_end ?? '' };
}

/** True when every working day has the same hours and lunch: the form then shows one shift instead of one per day. */
export function isUniform(rows) {
  const days = working(rows);
  const key = (r) => [r.opening_time, r.closing_time, r.closes_for_lunch, r.closes_for_lunch ? r.lunch_start : '', r.closes_for_lunch ? r.lunch_end : ''].join('|');
  return days.every((r) => key(r) === key(days[0]));
}

/** One shift for every working day: a change of start or end goes to all of them. */
export const setShift = (rows, patch) => rows.map((r) => (r.is_working ? { ...r, ...patch } : r));

/** A change of the lunch (on/off, start, end) goes to every working day. */
export const setLunch = (rows, patch) => rows.map((r) => (r.is_working ? { ...r, ...patch } : r));

/** Turns the shared lunch on or off for every working day (on starts from 12:00 PM to 1:00 PM when that fits). */
export function toggleSharedLunch(rows) {
  const on = sharedLunch(rows).on;
  return rows.map((r) => (r.is_working ? (on ? { ...r, closes_for_lunch: false } : toggleLunch({ ...r, closes_for_lunch: false })) : r));
}

/** Turning a pill on gives the day the shared shift (and lunch); turning it off clears the day. */
export function togglePill(rows, dow) {
  const shift = sharedShift(rows);
  const lunch = sharedLunch(rows);
  return rows.map((r) => {
    if (r.day_of_week !== dow) return r;
    const next = toggleWorking(r, shift);
    return next.is_working && lunch.on ? { ...next, closes_for_lunch: true, lunch_start: lunch.start, lunch_end: lunch.end } : next;
  });
}

/** The first problem for a field across the working days: what the shared inputs show when the days are not edited one by one. */
export function sharedError(errors, rows, field) {
  for (const r of working(rows)) {
    const message = errors[`days[${r.day_of_week}].${field}`];
    if (message) return message;
  }
  return null;
}

/** The campus schedule has no lunch break: its request carries only the days and hours (the form Core has always accepted). */
export const toCampusDays = (rows) => toDays(rows).map(({ day_of_week, is_working, opening_time, closing_time }) => ({ day_of_week, is_working, opening_time, closing_time }));

/**
 * A schedule as rows for the screen, one row per run of days that share the same hours: { days: 'Mon-Fri', hours: '8:00 AM to 5:00 PM',
 * lunch: 'Lunch 12:00 PM to 1:00 PM' | null }. Monday first, Sunday last; each row is meant to sit on one line. A schedule with no
 * working day is one row that says so.
 */
export function scheduleRows(items) {
  const byDay = new Map((items ?? []).map((i) => [i.day_of_week, i]));
  const rows = [];
  for (const dow of WEEK_ORDER) {
    const item = byDay.get(dow);
    if (!item?.is_working) continue;
    const hours = `${time12(item.opening_time) || item.opening_time} to ${time12(item.closing_time) || item.closing_time}`;
    const lunch = item.closes_for_lunch ? `Lunch ${time12(item.lunch_start) || item.lunch_start} to ${time12(item.lunch_end) || item.lunch_end}` : null;
    const last = rows.at(-1);
    if (last && last.hours === hours && last.lunch === lunch && last.lastDow === WEEK_ORDER[WEEK_ORDER.indexOf(dow) - 1]) {
      last.lastDow = dow;
      last.days = `${last.firstLabel}-${DAY_SHORT[dow]}`;
    } else {
      rows.push({ days: DAY_SHORT[dow], firstLabel: DAY_SHORT[dow], lastDow: dow, hours, lunch });
    }
  }
  if (rows.length === 0) return [{ days: '', hours: 'No working days', lunch: null }];
  return rows.map(({ days, hours, lunch }) => ({ days, hours, lunch }));
}

/** The line above an office's rows when it has no schedule of its own. */
export const FOLLOWS_CAMPUS_NOTE = 'No schedule set for this office yet. It follows the campus schedule:';

/** A saved version of the campus schedule as a record row (title, when it was added, the schedule, shown as rows). */
export function campusRecord(entry, { newest = false } = {}) {
  return {
    id: entry.audit_id ?? `v${entry.version_no}`,
    title: `Weekly schedule · version ${entry.version_no}`,
    added: formatDateTime(entry.occurred_at) || '',
    items: entry.items,
    badge: newest ? 'Current' : 'Weekly',
    removable: false,
  };
}

/** The one record an office with its own schedule has: its schedule, which can be removed (the office then follows the campus again). */
export function officeRecord({ officeName, version, items }) {
  return { id: `office-${version}`, title: `${officeName} weekly schedule`, added: `Version ${version}`, items, badge: 'Office schedule', removable: true };
}

/** The label of a record count: "1 record", "3 records". */
export const recordCount = (n) => `${n} ${n === 1 ? 'record' : 'records'}`;
