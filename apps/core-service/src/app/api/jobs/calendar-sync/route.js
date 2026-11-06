import { cronRoute } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { runCalendarSync } from '../../../../jobs/calendar-sync.js';
import { runHolidayAutoImport } from '../../../../lib/calendar/holiday-import.js';
import { importSmsTerms } from '../../../../lib/calendar/sms-terms-import.js';

export const dynamic = 'force-dynamic';

// Vercel Cron calls this (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
// In this order: (1) with SMS_TERMS_ENABLED=true it copies the terms SMS owns into the CCMS term list; (2) with
// HOLIDAY_AUTO_IMPORT=true it adds the national holidays of this year and the next; (3) it pushes due calendar changes to FMS
// and SMS and retries the ones that failed. The terms come first because every calendar entry is sent to SMS inside its term.
export const GET = cronRoute('calendar-sync', async () => {
  const db = await getDb();
  const terms = await importSmsTerms(db);
  const holidays = await runHolidayAutoImport(db);
  const sync = await runCalendarSync();
  return { ...sync, ...(terms.skipped ? {} : { terms }), ...(holidays.skipped ? {} : { holidays }) };
});
