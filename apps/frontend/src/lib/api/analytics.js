// Analytics (Insights) data access. EVERY analytics read goes through this file; pages and charts never call a service or the mock.
//
// SPRINT 6 DEPENDENCY: the analytics APIs do not exist yet and their contract is not published. Nothing here is a final contract.
// This file is the adapter boundary:
//   - ANALYTICS_BASE and the five paths below are PROVISIONAL (Oversight, which owns reports and analytics, is reached through the
//     gateway's /api/logs route). Change them here when Sprint 6 publishes the real ones; nothing else moves.
//   - The five answers are read by the normalizers in lib/ui/analytics.js, which tolerate missing fields, so a different spelling
//     is a change in that one file.
//   - An office-bound person is asked for their own office (`office_id`). The services must enforce it too; applyScope() then
//     drops any other office's row, so a source's mistake cannot reach the screen.
//
// DATA SOURCE FLAG (the only switch): NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA
//   'true'            -> illustrative sample data (any environment; the page always says so)
//   'false'           -> the API
//   unset             -> sample data in development, the API in production
// The mock is NEVER used as a fallback: if the API fails, the page shows the failure (and keeps the last good data).
import { apiFetch } from '../auth/session.js';
import { buildOverview } from '../ui/analytics.js';
import { toQuery } from './client.js';
import { getMockAnalytics } from './analytics-mock.js';

export const ANALYTICS_BASE = '/api/logs/analytics'; // provisional, see above
export const ANALYTICS_PATHS = Object.freeze({
  pulse: `${ANALYTICS_BASE}/compliance-pulse`,
  forecast: `${ANALYTICS_BASE}/forecast`,
  lateRisk: `${ANALYTICS_BASE}/late-risk`,
  heatmap: `${ANALYTICS_BASE}/heatmap`,
  insights: `${ANALYTICS_BASE}/insights`,
});

const withScope = (path, scope) => `${path}${toQuery({ office_id: scope?.kind === 'office' ? scope.officeId : undefined })}`;

export const getCompliancePulse = (scope, fetcher = apiFetch) => fetcher(withScope(ANALYTICS_PATHS.pulse, scope));
export const getForecast = (scope, fetcher = apiFetch) => fetcher(withScope(ANALYTICS_PATHS.forecast, scope));
export const getLateRiskSummary = (scope, fetcher = apiFetch) => fetcher(withScope(ANALYTICS_PATHS.lateRisk, scope));
export const getHeatmap = (scope, fetcher = apiFetch) => fetcher(withScope(ANALYTICS_PATHS.heatmap, scope));
export const getInsightSentences = (scope, fetcher = apiFetch) => fetcher(withScope(ANALYTICS_PATHS.insights, scope));

/** The five reads together, as one normalized overview. All five must succeed: a half-filled screen would mislead. */
export async function getAnalyticsOverview(scope, fetcher = apiFetch) {
  const [pulse, forecast, lateRisk, heatmap, insights] = await Promise.all([
    getCompliancePulse(scope, fetcher),
    getForecast(scope, fetcher),
    getLateRiskSummary(scope, fetcher),
    getHeatmap(scope, fetcher),
    getInsightSentences(scope, fetcher),
  ]);
  return buildOverview({ pulse, forecast, lateRisk, heatmap, insights }, { source: 'api', scope });
}

/** The flag and environment as the build sees them. Literal process.env names so Next.js can put the values into the browser bundle. */
export const analyticsEnv = () => ({ flag: process.env.NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA, nodeEnv: process.env.NODE_ENV });

/** True when sample data is the chosen source. */
export function isMockAnalytics({ flag, nodeEnv } = analyticsEnv()) {
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return nodeEnv !== 'production';
}

/** The one call the page makes. Same result shape from either source; the flag picks the source and nothing else. */
export async function loadAnalytics(scope, { fetcher = apiFetch, env = analyticsEnv(), now } = {}) {
  if (isMockAnalytics(env)) return getMockAnalytics(scope, { now });
  return getAnalyticsOverview(scope, fetcher);
}
