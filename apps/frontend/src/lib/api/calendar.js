// Helpers for the Calendar page. All dates and times are Asia/Manila (fixed UTC+08:00, no daylight
// saving), handled as plain strings or with UTC arithmetic so the browser's own time zone never matters.
// How dates and times are shown to people is in ../ui/date-format.js.
import { formatTimeRange } from '../ui/date-format.js';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; the API uses 0 = Sunday

/** "Mon-Fri 8:00 AM to 5:00 PM · Sat 8:00 AM to 12:00 PM" for a list of schedule items (non-working days are left out). */
export function describeSchedule(items) {
  const byDay = new Map(items.map((item) => [item.day_of_week, item]));
  const groups = [];
  for (const day of WEEK_ORDER) {
    const item = byDay.get(day);
    if (!item?.is_working) continue;
    const window = formatTimeRange(item.opening_time, item.closing_time) || `${item.opening_time}-${item.closing_time}`;
    const last = groups.at(-1);
    if (last && last.window === window && last.end === WEEK_ORDER[WEEK_ORDER.indexOf(day) - 1]) last.end = day;
    else groups.push({ start: day, end: day, window });
  }
  if (groups.length === 0) return 'No working days';
  return groups.map((g) => `${g.start === g.end ? DAY_SHORT[g.start] : `${DAY_SHORT[g.start]}-${DAY_SHORT[g.end]}`} ${g.window}`).join(' · ');
}
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const EXCEPTION_TYPES = [
  { value: 'REGULAR_HOLIDAY', label: 'Regular holiday' },
  { value: 'SPECIAL_NON_WORKING', label: 'Special non-working day' },
  { value: 'LOCAL_HOLIDAY', label: 'Local holiday' },
  { value: 'SUSPENSION', label: 'Suspension of work' },
];

export function typeLabel(value) {
  return EXCEPTION_TYPES.find((t) => t.value === value)?.label ?? value;
}

// How the Holidays tab groups the four real types: National (red), Local (amber), Campus (blue).
// Full class names are spelled out so Tailwind picks them up.
export const TYPE_CATEGORIES = [
  { id: 'national', label: 'National', dot: 'bg-red-600', badge: 'bg-red-50 text-red-700' },
  { id: 'local', label: 'Local', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700' },
  { id: 'campus', label: 'Campus', dot: 'bg-blue-600', badge: 'bg-blue-50 text-blue-700' },
];
const CATEGORY_BY_TYPE = { REGULAR_HOLIDAY: 'national', SPECIAL_NON_WORKING: 'national', LOCAL_HOLIDAY: 'local', SUSPENSION: 'campus' };

export function typeCategory(value) {
  const id = CATEGORY_BY_TYPE[value] ?? 'local';
  return TYPE_CATEGORIES.find((c) => c.id === id);
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Today's 'YYYY-MM-DD' in Manila. */
export function todayManila() {
  return new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function dateString(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Month is 1-12. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 (Sunday) to 6 for the first day of the month. */
export function firstWeekday(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The entry's date in the given year, or null when it does not occur in that year. */
export function occurrenceIn(entry, dateStr) {
  if (entry.exception_date === dateStr) return true;
  if (!entry.is_recurring) return false;
  return entry.exception_date.slice(5) === dateStr.slice(5) && Number(dateStr.slice(0, 4)) >= Number(entry.exception_date.slice(0, 4));
}

/** The date a (possibly recurring) entry falls on inside a month, or null. */
export function occurrenceInMonth(entry, year, month) {
  if (!entry.is_recurring) {
    return entry.exception_date.slice(0, 7) === `${pad(year, 4)}-${pad(month)}` ? entry.exception_date : null;
  }
  if (Number(entry.exception_date.slice(5, 7)) !== month || year < Number(entry.exception_date.slice(0, 4))) return null;
  const date = `${pad(year, 4)}-${entry.exception_date.slice(5)}`;
  return occurrenceIn(entry, date) ? date : null;
}

export function isValidTime(text) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** Accepts HH:MM from a time input (or HH:MM:SS) and returns HH:MM. */
export function normalizeTime(text) {
  return typeof text === 'string' ? text.slice(0, 5) : '';
}

export const SYNC_LABELS = { PENDING: 'Pending', SENT: 'Sent', ACKNOWLEDGED: 'Acknowledged', FAILED: 'Failed' };

// ---- Class suspensions (CC015): which part of the campus a calendar entry affects ----
// Core fields: applies_to (BOTH | CLASSES | WORK, default BOTH) and class_mode (SUSPENDED | ONLINE, or null for WORK only).
// They are only accepted while the setting applies_to_enabled is on; while it is off Core refuses any class_mode and any applies_to
// other than BOTH, so the form then sends neither and every entry stays BOTH. class_mode never changes working minutes (Core's engine).

export const APPLIES_TO = [
  { value: 'BOTH', label: 'Offices and classes', short: 'O+C', help: 'Offices are closed and classes are affected.' },
  { value: 'CLASSES', label: 'Classes only', short: 'C', help: 'Classes are affected; offices stay open.' },
  { value: 'WORK', label: 'Offices only', short: 'O', help: 'Offices are closed; classes continue.' },
];
export const CLASS_MODES = [
  { value: 'SUSPENDED', label: 'No classes' },
  { value: 'ONLINE', label: 'Online' },
];
export const APPLIES_TO_ERROR = 'Choose Offices and classes, Classes only or Offices only.';
export const CLASS_MODE_ERROR = 'Choose No classes or Online.';
export const CLASS_MODE_WORK_ERROR = 'Classes are not affected when an entry applies to offices only.';

export const appliesToLabel = (value) => APPLIES_TO.find((a) => a.value === value)?.label ?? value;
export const appliesToShort = (value) => APPLIES_TO.find((a) => a.value === value)?.short ?? '';
export const classModeLabel = (value) => CLASS_MODES.find((c) => c.value === value)?.label ?? '';

/** "Classes only · No classes", "Offices and classes · Online", "Offices only" (class mode only where classes are affected). */
export function describeEffect(entry) {
  const applies = entry?.applies_to ?? 'BOTH';
  const mode = applies === 'WORK' ? '' : classModeLabel(entry?.class_mode);
  return mode ? `${appliesToLabel(applies)} · ${mode}` : appliesToLabel(applies);
}

/** The class mode that goes with an Applies to choice: none for offices only; otherwise the current one, or No classes by default. */
export function classModeFor(appliesTo, current) {
  if (appliesTo === 'WORK') return '';
  return CLASS_MODES.some((c) => c.value === current) ? current : 'SUSPENDED';
}

/** Early feedback on the combination (Core checks again). Returns { applies_to?, class_mode? }; empty when valid or when the setting is off. */
export function appliesToErrors(enabled, appliesTo, classMode) {
  if (!enabled) return {};
  const errors = {};
  if (!APPLIES_TO.some((a) => a.value === appliesTo)) errors.applies_to = APPLIES_TO_ERROR;
  else if (appliesTo === 'WORK') {
    if (classMode) errors.class_mode = CLASS_MODE_WORK_ERROR;
  } else if (!CLASS_MODES.some((c) => c.value === classMode)) errors.class_mode = CLASS_MODE_ERROR;
  return errors;
}

/**
 * The applies_to part of a create or edit body. While the setting is off: nothing (Core refuses any class_mode and any value other
 * than BOTH, and keeps BOTH). While it is on: both fields, class_mode null for offices only, so an edit never falls back to a default.
 */
export function appliesToBody(enabled, appliesTo, classMode) {
  if (!enabled) return {};
  return { applies_to: appliesTo, class_mode: appliesTo === 'WORK' ? null : classMode };
}

/** What the form starts with for a saved entry: its real values (older entries come back as BOTH), never a guess. */
export function formAppliesTo(entry) {
  const appliesTo = APPLIES_TO.some((a) => a.value === entry?.applies_to) ? entry.applies_to : 'BOTH';
  return { applies_to: appliesTo, class_mode: appliesTo === 'WORK' ? '' : classModeFor(appliesTo, entry?.class_mode) };
}

/** Entries that fall under an Applies to filter ('' = all). The service filters too (?applies_to=); this keeps the day markers in step. */
export const matchesAppliesTo = (entry, filter) => !filter || (entry.applies_to ?? 'BOTH') === filter;

/** Core's answers to a failed settings change as { message }, with its own words for the case it explains. */
export function settingsErrorMessage(err) {
  if (err?.status === 403) return 'Only a Super Admin can change this setting.';
  if (err?.status === 409 && err?.code === 'CALENDAR_SETTING_IN_USE') return err.message;
  if (err?.code === 'NETWORK_ERROR') return err.message;
  if (err?.status >= 500) return 'The setting could not be saved right now. Please try again in a few minutes.';
  return err?.message ?? 'The setting could not be saved. Please try again.';
}
