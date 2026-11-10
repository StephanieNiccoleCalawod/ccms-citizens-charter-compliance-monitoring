import { json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { exportAnalyticsPage, parseExportQuery } from '../../../../modules/analytics/export.js';

export const dynamic = 'force-dynamic';

// GET /transactions/analytics-export?limit=&cursor= (TT2) — every transaction as an analytics snapshot, page by page,
// for the Oversight backfill. Service key only (a user token is never enough); the gateway refuses this path for every
// method. Answers { schema_version, items, next_cursor }.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const query = parseExportQuery(new URL(request.url).searchParams);
  return json(await exportAnalyticsPage(await getDb(), query), 200, { 'cache-control': 'no-store' });
});
