import { cronRoute } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { runCalendarSync } from '../../../../jobs/calendar-sync.js';
import { runHolidayAutoImport } from '../../../../lib/calendar/holiday-import.js';

export const dynamic = 'force-dynamic';

// Vercel Cron calls this (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
// With HOLIDAY_AUTO_IMPORT=true it first adds the national holidays of this year and the next (new entries are queued),
// then it pushes due calendar and term changes to FMS and SMS and retries the ones that failed.
export const GET = cronRoute('calendar-sync', async () => {
  const holidays = await runHolidayAutoImport(await getDb());
  const sync = await runCalendarSync();
  return holidays.skipped ? sync : { ...sync, holidays };
});
