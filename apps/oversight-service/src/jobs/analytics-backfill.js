import { getDb } from '../lib/data-source.js';
import { HOSTED_BACKFILL_BUDGET, runAnalyticsBackfill } from '../modules/analytics/backfill.js';

/**
 * One bounded run of the TT2 backfill (GET /api/jobs/analytics-backfill, CRON_SECRET only): at most 20 pages of 500
 * transactions or about 20 seconds, then the cursor is kept for the next invocation. Not scheduled by TT2.
 */
export async function runAnalyticsBackfillJob(overrides = {}) {
  return runAnalyticsBackfill({
    dataSource: await getDb(),
    operationsUrl: process.env.OPERATIONS_SERVICE_URL,
    serviceKey: process.env.SERVICE_KEY,
    ...HOSTED_BACKFILL_BUDGET,
    ...overrides,
  });
}
