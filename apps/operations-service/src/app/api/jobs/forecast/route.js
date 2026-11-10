import { cronRoute } from 'ccms-shared';
import { runForecastJob } from '../../../../jobs/forecast.js';

export const dynamic = 'force-dynamic';

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
// Nightly at 02:00 Manila time (18:00 UTC = 02:00+08:00): schedule "0 18 * * *"
export const GET = cronRoute('forecast', () => runForecastJob());
