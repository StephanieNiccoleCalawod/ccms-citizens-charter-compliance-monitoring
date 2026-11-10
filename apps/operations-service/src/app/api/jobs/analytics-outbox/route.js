import { cronRoute } from 'ccms-shared';
import { runAnalyticsDispatch } from '../../../../jobs/analytics-dispatch.js';

export const dynamic = 'force-dynamic';

// TT2 recovery: "Authorization: Bearer $CRON_SECRET" only (not reachable through the gateway). Sends one batch of
// analytics events to Oversight. Not scheduled in vercel.json by TT2; see README "Analytics feed (TT2)".
export const GET = cronRoute('analytics-outbox', () => runAnalyticsDispatch());
