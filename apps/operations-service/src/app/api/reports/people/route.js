import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readPeopleReport } from '../../../../modules/reports/people.js';
import { requireStaffSwitch } from '../../../../modules/transaction/switches.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const GET = route(async (request) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_REPORTS');
  return json(await readPeopleReport(await getDb(), user, new URL(request.url).searchParams), 200, { 'cache-control': 'private, no-store' });
});
