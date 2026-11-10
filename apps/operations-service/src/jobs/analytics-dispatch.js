import { getDb } from '../lib/data-source.js';
import { dispatchAnalyticsOutbox } from '../modules/analytics/dispatch.js';

/**
 * TT2: sends one batch (at most 500) of analytics events from analytics_outbox to Oversight. Run right after a change
 * commits (lib/outbox.js kickAnalytics) and by the protected run-once route /api/jobs/analytics-outbox (recovery).
 * Oversight is the Logs service, so its address is LOGS_SERVICE_URL (with or without /api).
 */
export async function runAnalyticsDispatch({ fetchImpl, dataSource } = {}) {
  const oversightUrl = process.env.LOGS_SERVICE_URL;
  const serviceKey = process.env.SERVICE_KEY;
  if (!oversightUrl || !serviceKey) {
    return { skipped: true, reason: 'LOGS_SERVICE_URL and SERVICE_KEY are required', claimed: 0, delivered: 0, failed: 0 };
  }
  return { skipped: false, ...(await dispatchAnalyticsOutbox(dataSource ?? (await getDb()), { oversightUrl, serviceKey, fetchImpl })) };
}
