import { json, readBoundedJson, requireServiceKey, route, validateAnalyticsBatch } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { ingestAnalyticsEvents } from '../../../modules/analytics/store.js';

export const dynamic = 'force-dynamic';

// POST /analytics-events (TT2) — a batch of analytics events from Operations. Service key only, checked before the body
// is read: a user token is never enough, and the gateway refuses this path for every method and every Oversight alias.
// Body { events: [...] } of at most 500 events and 1 MiB, validated as a whole before anything is written (shared
// contract), then upserted in one database transaction. 200 { accepted, applied, ignored }; the events are never echoed.
export const POST = route(async (request) => {
  requireServiceKey(request);
  const events = validateAnalyticsBatch(await readBoundedJson(request));
  return json(await ingestAnalyticsEvents(await getDb(), events));
});
