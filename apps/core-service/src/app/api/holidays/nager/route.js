import { Errors, ROLES, isValidManilaDate, json, requirePermission, route } from 'ccms-shared';
import { fetchNagerHolidays, isHolidayYear } from '../../../../lib/calendar/holiday-import.js';

export const dynamic = 'force-dynamic';

const superAdmin = requirePermission([ROLES.SUPER_ADMIN], 'campus');

// The provider is a reference feed. Adding a date uses the normal calendar exception route.
export const GET = route(async (request) => {
  await superAdmin(request);
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!isHolidayYear(year)) {
    throw Errors.validation('Choose a year from 1900 to 2200', { year: 'Enter a year from 1900 to 2200' });
  }

  let holidays;
  try {
    holidays = await fetchNagerHolidays(year);
  } catch {
    throw Errors.unavailable('Nager.Date is unavailable right now. Please try again.', 'HOLIDAY_SOURCE_UNAVAILABLE');
  }

  const items = holidays
    .filter((holiday) => holiday?.countryCode === 'PH' && holiday.nationalHoliday === true &&
      Array.isArray(holiday.holidayTypes) && holiday.holidayTypes.includes('Public') &&
      isValidManilaDate(holiday.date) && holiday.date.startsWith(`${year}-`) &&
      typeof holiday.name === 'string' && holiday.name.trim())
    .map(({ date, name }) => ({ date, name: name.trim().slice(0, 200) }));
  return json({ year, items }, 200, { 'cache-control': 'no-store' });
});
