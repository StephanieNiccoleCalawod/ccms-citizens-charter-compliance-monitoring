import { ROLES, hasGrant, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readPeopleReport } from '../../../../modules/reports/people.js';
import { requireStaffSwitch } from '../../../../modules/transaction/switches.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const GET = route(async (request) => {
  const user = await canRead(request);
  // S8-52: an Office Staff member with the granted permission "Reports per person" reads reports of their own office like an Office Head.
  const granted = user.role === ROLES.OFFICE_STAFF && await hasGrant(user, 'REPORTS_PER_PERSON');
  if (!granted) await requireStaffSwitch(user, 'STAFF_VIEW_REPORTS');
  const reader = granted ? { ...user, role: ROLES.OFFICE_HEAD } : user;
  return json(await readPeopleReport(await getDb(), reader, new URL(request.url).searchParams), 200, { 'cache-control': 'private, no-store' });
});
