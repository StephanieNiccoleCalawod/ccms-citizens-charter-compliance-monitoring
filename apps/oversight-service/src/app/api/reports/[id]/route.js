import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { requireStaffSwitch } from '../../../../lib/switches.js';
import { getDb } from '../../../../lib/data-source.js';
import { fetchReport } from '../../../../modules/reports/reports.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

export const GET = route(async (request, { params }) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_REPORTS');
  return json(await fetchReport(await getDb(), user, params.id), 200, { 'cache-control': 'no-store' });
});
