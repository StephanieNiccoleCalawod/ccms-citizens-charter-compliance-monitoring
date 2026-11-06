import { Errors, ROLE_LIST, json, requirePermission, route } from 'ccms-shared';
import { fetchNagerHolidays, isHolidayYear } from '../../../../lib/calendar/holiday-import.js';
import { PHILIPPINE_HOLIDAYS } from '../../../../lib/calendar/philippine-holidays.js';

export const dynamic = 'force-dynamic';

const canRead = requirePermission(ROLE_LIST, 'campus');
const live = { 'cache-control': 'no-store' };

// Calendar reference dates are read live. Only saved exceptions affect the working-time engine.
export const GET = route(async (request) => {
  await canRead(request);
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!isHolidayYear(year)) {
    throw Errors.validation('Choose a year from 1900 to 2200', { year: 'Enter a year from 1900 to 2200' });
  }

  const verified = PHILIPPINE_HOLIDAYS[year];
  if (!verified) return json({ year, verified: false, items: [] }, 200, live);

  let holidays;
  try {
    holidays = await fetchNagerHolidays(year);
  } catch {
    throw Errors.unavailable('Nager.Date is unavailable right now. Please try again.', 'HOLIDAY_SOURCE_UNAVAILABLE');
  }

  const dates = new Set(holidays.filter((holiday) =>
    holiday?.countryCode === 'PH' && holiday.nationalHoliday === true &&
    Array.isArray(holiday.holidayTypes) && holiday.holidayTypes.includes('Public')).map(({ date }) => date));
  const items = verified
    .map(([day, type, name]) => ({ date: `${year}-${day}`, type, name }))
    .filter(({ date }) => dates.has(date));
  return json({ year, verified: true, items }, 200, live);
});
