import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { getKpis } from '../../../../modules/analytics/kpi.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

export const GET = route(async (request) => {
  const user = await canRead(request);
  return json(await getKpis(await getDb(), user, new URL(request.url).searchParams));
});
