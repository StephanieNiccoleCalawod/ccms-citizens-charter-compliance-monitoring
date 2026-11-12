import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { acknowledgeComplaint } from '../../../../../modules/complaints/handling.js';

export const dynamic = 'force-dynamic';
// Super Admin and Office Head (own office). Office Staff and the Executive: 403.
const canHandle = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]);

export const POST = route(async (request, { params }) => {
  const user = await canHandle(request);
  return json(await acknowledgeComplaint(await getDb(), user, params.id), 200, { 'cache-control': 'no-store' });
});
