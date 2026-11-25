import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { getInsights } from '../../../../../modules/insights/insights.js';
import { resolveTermQuery } from '../../../../../modules/analytics/term-period.js';

export const dynamic = 'force-dynamic';
// CC053 / CC054: pulse (store part), office x service heatmap, insight sentences, Charter check. Office Head and Office Staff: own office.
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

export const GET = route(async (request) => {
  const user = await canRead(request);
  const { query, label } = await resolveTermQuery(new URL(request.url).searchParams, { authorization: request.headers.get('authorization') });
  const result = await getInsights(await getDb(), user, query);
  return json(label ? { ...result, period_label: label } : result, 200, { 'cache-control': 'private, no-store' });
});
