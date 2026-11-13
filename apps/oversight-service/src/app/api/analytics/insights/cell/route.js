import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { getCell } from '../../../../../modules/insights/insights.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

// A heatmap cell: weekly late rate and the late transactions of one office and service.
export const GET = route(async (request) => {
  const user = await canRead(request);
  return json(await getCell(await getDb(), user, new URL(request.url).searchParams), 200, { 'cache-control': 'private, no-store' });
});
