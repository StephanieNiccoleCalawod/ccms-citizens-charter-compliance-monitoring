// How CCMS shows dates and times to people (Decision C32). Display only: the API, the forms and every
// integration keep their machine formats (YYYY-MM-DD, 24-hour HH:MM, ISO date-times), and a value is
// formatted only at the moment it is put on the screen, never before it is sent.
//
//   formatDate('2026-11-10')                -> '11/10/2026'
//   formatDateTime('2026-11-10T06:05:00Z')  -> '11/10/2026 2:05 PM'   (Asia/Manila)
//   formatTime('13:00')                     -> '1:00 PM'
//
// None of them uses the browser's time zone or locale. Date-only and time-only values are plain
// calendar and clock values and are never converted; date-times are shifted by the fixed Asia/Manila
// offset (UTC+08:00, no daylight saving) with UTC arithmetic. A missing or unreadable value gives ''
// (the same as the older manilaDateTime), and the screen decides what to show instead (for example '-').

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

function clock(hours24, minutes) {
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad(minutes)} ${suffix}`;
}

/** '2026-11-10' -> '11/10/2026'. A real calendar date is required; anything else (or empty) gives ''. */
export function formatDate(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return '';
  const [, year, month, day] = match;
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Rejects 2026-02-30 and the like; Date.UTC would quietly roll them into March.
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return '';
  return `${month}/${day}/${year}`;
}

/** '13:00' (or '13:00:00') -> '1:00 PM'; '00:00' -> '12:00 AM'; '12:00' -> '12:00 PM'. Anything else gives ''. */
export function formatTime(value) {
  const match = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value) : null;
  return match ? clock(Number(match[1]), Number(match[2])) : '';
}

/**
 * An ISO date-time with an explicit offset ('2026-11-10T06:05:00Z' or '...+08:00') -> '11/10/2026 2:05 PM' in
 * Asia/Manila. A date-time with no offset is refused (''): it would mean the browser's own clock.
 */
export function formatDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return '';
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return '';
  const manila = new Date(ms + MANILA_OFFSET_MS);
  const date = `${pad(manila.getUTCMonth() + 1)}/${pad(manila.getUTCDate())}/${manila.getUTCFullYear()}`;
  return `${date} ${clock(manila.getUTCHours(), manila.getUTCMinutes())}`;
}

/** '08:00' and '17:00' -> '8:00 AM to 5:00 PM'. '' when either time is unreadable. */
export function formatTimeRange(from, to) {
  const start = formatTime(from);
  const end = formatTime(to);
  return start && end ? `${start} to ${end}` : '';
}
