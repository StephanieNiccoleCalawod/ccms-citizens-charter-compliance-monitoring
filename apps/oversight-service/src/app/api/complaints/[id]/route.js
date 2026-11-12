import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { requireStaffSwitch } from '../../../../lib/switches.js';
import { getComplaint } from '../../../../modules/complaints/handling.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

// GET /complaints/:id (CC034 / CC035). A complaint of another office is a 404 for the Office Head and Office Staff.
export const GET = route(async (request, { params }) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_COMPLAINTS');
  return json(await getComplaint(await getDb(), user, params.id), 200, { 'cache-control': 'no-store' });
});
