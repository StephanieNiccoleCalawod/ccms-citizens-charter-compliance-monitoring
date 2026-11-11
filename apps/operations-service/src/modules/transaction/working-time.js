import { Errors, toManilaDateTime } from 'ccms-shared';
import { CoreRejectedError, CoreUnavailableError } from './core-client.js';
import { MSG } from './constants.js';

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * CC051: is this instant (Asia/Manila) inside working time for the office? Core knows the schedule, holidays, suspensions and
 * non-working weekdays. Its working intervals exclude lunch and part-day suspensions.
 * The opening time counts, the closing time does not.
 */
export async function isWithinWorkingTime(core, { officeId, at }) {
  const [date, clock] = toManilaDateTime(at).split(' ');
  const day = await core.isWorkingDay(date, officeId, { includeIntervals: true });
  if (!day.is_working_day) return false;
  const minute = minutesOf(clock.slice(0, 5));
  // Older Core deployments return only the opening/closing window.
  const intervals = day.working_intervals ?? [day.window];
  return intervals.some(({ opening_time, closing_time }) => minute >= minutesOf(opening_time) && minute < minutesOf(closing_time));
}

/**
 * Returns true when the Start is outside working time and was confirmed (the row is then flagged), false when it is inside.
 * Outside and not confirmed: 409 OUTSIDE_WORKING_TIME and nothing is created. Core unreachable: 503, the same rule as the
 * standard lookup (B13), nothing is saved.
 */
export async function assertWorkingTimeOrConfirmed(core, { officeId, at, confirmed }) {
  let inside;
  try {
    inside = await isWithinWorkingTime(core, { officeId, at });
  } catch (err) {
    if (err instanceof CoreUnavailableError || err instanceof CoreRejectedError) throw Errors.unavailable(MSG.CALENDAR_START_DOWN, 'CALENDAR_UNAVAILABLE');
    throw err;
  }
  if (inside) return false;
  if (!confirmed) throw Errors.conflict(MSG.OUTSIDE_HOURS, 'OUTSIDE_WORKING_TIME');
  return true;
}
