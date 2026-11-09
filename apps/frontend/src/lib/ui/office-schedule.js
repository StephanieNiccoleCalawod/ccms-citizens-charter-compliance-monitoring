// CC048: an office's working days, hours and lunch break, the parts that are not React. Pure functions so they are tested without a browser.
//
// Times travel as 24-hour 'HH:MM' (the form of the campus schedule and of the database); they are SHOWN as 8:00 AM / 12:00 PM / 5:00 PM
// through the shared formatter. Core checks every rule again, with the same words, so a message here and a message from Core read the same.
import { ROLES } from 'ccms-shared/roles';
import { WEEK_ORDER } from '../api/calendar.js';
import { formatTime } from './date-format.js';

export const DEFAULT_OPEN = '08:00';
export const DEFAULT_CLOSE = '17:00';
export const DEFAULT_LUNCH_START = '12:00';
export const DEFAULT_LUNCH_END = '13:00';
export const CAMPUS_SCOPE = 'campus';

export const MSG = Object.freeze({
  OPENING_REQUIRED: 'Opening time is required on a working day',
  CLOSING_REQUIRED: 'Closing time is required on a working day',
  CLOSING_AFTER_OPENING: 'Closing time must be after opening time',
  LUNCH_START_REQUIRED: 'Lunch start is required when the office closes for lunch',
  LUNCH_END_REQUIRED: 'Lunch end is required when the office closes for lunch',
  LUNCH_START_INSIDE: 'Lunch must start within the opening hours',
  LUNCH_END_INSIDE: 'Lunch must end within the opening hours',
  LUNCH_END_AFTER_START: 'Lunch end must be after lunch start',
  ONE_WORKING_DAY: 'At least one working day is required',
  CONFLICT: 'This schedule was changed by someone else while you were editing it. Reload it to see the latest version; your edits have not been saved.',
});

/** 8:00 AM for '08:00'; '' for anything that is not a time. */
export const time12 = (value) => formatTime(value) || '';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (value) => {
  const match = typeof value === 'string' ? HHMM.exec(value.trim()) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Who may see an office's schedule, and who may change it (Core decides again). */
export const canViewOfficeSchedule = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.EXECUTIVE || role === ROLES.OFFICE_HEAD;
export const canEditOfficeSchedule = (role) => role === ROLES.SUPER_ADMIN;

/**
 * The choices of the schedule selector: always the Campus, then the offices the person may see: every office for a Super Admin or
 * Executive, only their own for an Office Head, none for anyone else. `offices` is the Catalogue's list.
 */
export function scopeOptions(user, offices) {
  const options = [{ value: CAMPUS_SCOPE, label: 'Campus' }];
  if (!canViewOfficeSchedule(user?.role)) return options;
  const mine = user.role === ROLES.OFFICE_HEAD;
  for (const office of offices ?? []) {
    if (mine && office.office_id !== user.officeId) continue;
    options.push({ value: office.office_id, label: `${office.office_code} - ${office.office_name}`, officeId: office.office_id, name: office.office_name });
  }
  return options;
}

/** The editable rows (Sunday first) from the API's items. Empty times are '' so inputs stay controlled. */
export function toRows(items) {
  return [...(items ?? [])]
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((d) => ({
      day_of_week: d.day_of_week,
      is_working: d.is_working === true,
      opening_time: d.opening_time ?? '',
      closing_time: d.closing_time ?? '',
      closes_for_lunch: d.is_working === true && d.closes_for_lunch === true,
      lunch_start: d.lunch_start ?? '',
      lunch_end: d.lunch_end ?? '',
    }));
}

/** The rows in the order the page shows them: Monday first, Sunday last. */
export const inWeekOrder = (rows) => WEEK_ORDER.map((dow) => rows.find((r) => r.day_of_week === dow)).filter(Boolean);

/** Turning a day on gives it the usual hours (or the hours of the working day before it); turning it off clears everything. */
export function toggleWorking(row, template = { opening_time: DEFAULT_OPEN, closing_time: DEFAULT_CLOSE }) {
  if (row.is_working) return { ...row, is_working: false, opening_time: '', closing_time: '', closes_for_lunch: false, lunch_start: '', lunch_end: '' };
  return { ...row, is_working: true, opening_time: template.opening_time || DEFAULT_OPEN, closing_time: template.closing_time || DEFAULT_CLOSE };
}

/** Turning lunch on starts from 12:00 PM to 1:00 PM when the times fit the day, else from the day's own opening time; off keeps the times typed. */
export function toggleLunch(row) {
  if (!row.is_working) return row;
  if (row.closes_for_lunch) return { ...row, closes_for_lunch: false };
  const open = minutes(row.opening_time);
  const close = minutes(row.closing_time);
  const fits = open !== null && close !== null && minutes(DEFAULT_LUNCH_START) >= open && minutes(DEFAULT_LUNCH_END) <= close;
  return { ...row, closes_for_lunch: true, lunch_start: row.lunch_start || (fits ? DEFAULT_LUNCH_START : ''), lunch_end: row.lunch_end || (fits ? DEFAULT_LUNCH_END : '') };
}

/** The request body's days: a working day sends its hours and lunch; a non-working day sends none. */
export function toDays(rows) {
  return [...rows]
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((r) =>
      r.is_working
        ? {
            day_of_week: r.day_of_week,
            is_working: true,
            opening_time: r.opening_time.trim(),
            closing_time: r.closing_time.trim(),
            closes_for_lunch: r.closes_for_lunch === true,
            lunch_start: r.closes_for_lunch ? r.lunch_start.trim() : null,
            lunch_end: r.closes_for_lunch ? r.lunch_end.trim() : null,
          }
        : { day_of_week: r.day_of_week, is_working: false, opening_time: null, closing_time: null, closes_for_lunch: false, lunch_start: null, lunch_end: null },
    );
}

/** The key of a field problem, the same spelling Core uses: days[2].closing_time. */
export const errorKey = (dow, field) => `days[${dow}].${field}`;

/** Every problem in the rows, so nothing invalid is sent. Returns { 'days[2].closing_time': message, ... } (and 'days' for no working day). */
export function validateRows(rows) {
  const errors = {};
  const problem = (dow, field, message) => {
    errors[errorKey(dow, field)] ??= message;
  };
  for (const r of rows) {
    if (!r.is_working) continue;
    const open = minutes(r.opening_time);
    const close = minutes(r.closing_time);
    if (!r.opening_time.trim()) problem(r.day_of_week, 'opening_time', MSG.OPENING_REQUIRED);
    else if (open === null) problem(r.day_of_week, 'opening_time', 'Time must be in 24-hour HH:MM format');
    if (!r.closing_time.trim()) problem(r.day_of_week, 'closing_time', MSG.CLOSING_REQUIRED);
    else if (close === null) problem(r.day_of_week, 'closing_time', 'Time must be in 24-hour HH:MM format');
    if (open !== null && close !== null && close <= open) problem(r.day_of_week, 'closing_time', MSG.CLOSING_AFTER_OPENING);
    if (!r.closes_for_lunch) continue;
    const from = minutes(r.lunch_start);
    const until = minutes(r.lunch_end);
    if (!r.lunch_start.trim()) problem(r.day_of_week, 'lunch_start', MSG.LUNCH_START_REQUIRED);
    else if (from === null) problem(r.day_of_week, 'lunch_start', 'Time must be in 24-hour HH:MM format');
    if (!r.lunch_end.trim()) problem(r.day_of_week, 'lunch_end', MSG.LUNCH_END_REQUIRED);
    else if (until === null) problem(r.day_of_week, 'lunch_end', 'Time must be in 24-hour HH:MM format');
    const hours = open !== null && close !== null && close > open;
    if (hours && from !== null && (from < open || from >= close)) problem(r.day_of_week, 'lunch_start', MSG.LUNCH_START_INSIDE);
    if (hours && until !== null && (until > close || until <= open)) problem(r.day_of_week, 'lunch_end', MSG.LUNCH_END_INSIDE);
    if (from !== null && until !== null && until <= from) problem(r.day_of_week, 'lunch_end', MSG.LUNCH_END_AFTER_START);
  }
  if (!Object.keys(errors).length && !rows.some((r) => r.is_working)) errors.days = MSG.ONE_WORKING_DAY;
  return errors;
}

/** True when two sets of rows are the same schedule. */
export const sameRows = (a, b) => JSON.stringify(toDays(a)) === JSON.stringify(toDays(b));

/** 409 from Core: someone else saved first. */
export const isVersionConflict = (error) => error?.status === 409 && (error?.code === 'OFFICE_SCHEDULE_VERSION_CONFLICT' || error?.code === undefined);

/**
 * What a failed save means for the screen: { kind: 'conflict' } (reload offered, nothing overwritten), { kind: 'invalid', fieldErrors }
 * (Core named the fields) or { kind: 'error', message }.
 */
export function saveFailure(error) {
  if (isVersionConflict(error)) return { kind: 'conflict', message: MSG.CONFLICT, currentVersion: error?.details?.current_version ?? null };
  if (error?.status === 400 && error.details && typeof error.details === 'object') {
    const { version, ...fields } = error.details;
    return { kind: 'invalid', fieldErrors: fields, message: version ?? 'Please correct the highlighted fields.' };
  }
  if (error?.status === 403) return { kind: 'error', message: 'Only a Super Admin can change an office schedule.' };
  return { kind: 'error', message: error?.message || 'The schedule could not be saved. Please try again.' };
}

/** "8:00 AM to 5:00 PM", and "Lunch 12:00 PM to 1:00 PM" when the day has one; "Closed" for a non-working day. */
export function describeDay(item) {
  if (!item?.is_working) return { hours: 'Closed', lunch: null };
  const hours = `${time12(item.opening_time) || item.opening_time} to ${time12(item.closing_time) || item.closing_time}`;
  const lunch = item.closes_for_lunch ? `Lunch ${time12(item.lunch_start) || item.lunch_start} to ${time12(item.lunch_end) || item.lunch_end}` : null;
  return { hours, lunch };
}
