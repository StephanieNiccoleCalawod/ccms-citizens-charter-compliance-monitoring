import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { publishReport } from '../../../../../modules/reports/reports.js';

export const dynamic = 'force-dynamic';
const canPublish = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]);

export const POST = route(async (request, { params }) => {
  const user = await canPublish(request);
  return json(await publishReport(await getDb(), user, params.id, await readJson(request)), 200, { 'cache-control': 'no-store' });
});
