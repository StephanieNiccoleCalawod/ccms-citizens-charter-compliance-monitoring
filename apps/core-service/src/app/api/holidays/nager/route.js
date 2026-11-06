import { Errors, ROLE_LIST, isValidManilaDate, json, requirePermission, route } from 'ccms-shared';
import { fetchNagerHolidays, isHolidayYear } from '../../../../lib/calendar/holiday-import.js';

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

  let holidays;
  try {
    holidays = await fetchNagerHolidays(year);
  } catch (error) {
    // The fixed PH endpoint responds with 400 when the year is outside its coverage.
    if (error?.status === 400) return json({ year, available: false, items: [] }, 200, live);
    throw Errors.unavailable('Nager.Date is unavailable right now. Please try again.', 'HOLIDAY_SOURCE_UNAVAILABLE');
  }

  const items = new Map();
  for (const holiday of holidays) {
    if (holiday?.countryCode !== 'PH' || holiday.nationalHoliday !== true ||
        !Array.isArray(holiday.holidayTypes) || !holiday.holidayTypes.includes('Public')) continue;
    const { date, name } = holiday;
    if (typeof date !== 'string' || !date.startsWith(`${year}-`) || !isValidManilaDate(date)) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    const label = name.trim().slice(0, 200);
    items.set(`${date}:${label}`, { date, name: label });
  }
  return json({ year, available: true, items: [...items.values()] }, 200, live);
});
