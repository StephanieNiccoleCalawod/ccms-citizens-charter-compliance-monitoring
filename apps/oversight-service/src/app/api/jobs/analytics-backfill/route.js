import { cronRoute } from 'ccms-shared';
import { runAnalyticsBackfillJob } from '../../../../jobs/analytics-backfill.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// TT2: "Authorization: Bearer $CRON_SECRET" only (the gateway never forwards /api/jobs). One bounded, resumable
// backfill run; answers counts only. Manual invocation and recovery: README "Analytics feed (TT2)".
export const GET = cronRoute('analytics-backfill', () => runAnalyticsBackfillJob());
