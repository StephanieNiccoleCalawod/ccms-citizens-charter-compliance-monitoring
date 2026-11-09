import { Errors, toManilaDateTime } from 'ccms-shared';
import { CoreRejectedError, CoreUnavailableError } from './core-client.js';
import { MSG } from './constants.js';

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * CC051: is this instant (Asia/Manila) inside working time for the office? Core knows the schedule, holidays, suspensions and
 * non-working weekdays; its /is-working-day answer for the Manila date gives the window of that day (null when closed).
 * The opening time counts, the closing time does not.
 */
export async function isWithinWorkingTime(core, { officeId, at }) {
  const [date, clock] = toManilaDateTime(at).split(' ');
  const day = await core.isWorkingDay(date, officeId);
  if (!day.is_working_day) return false;
  const minute = minutesOf(clock.slice(0, 5));
  return minute >= minutesOf(day.window.opening_time) && minute < minutesOf(day.window.closing_time);
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
