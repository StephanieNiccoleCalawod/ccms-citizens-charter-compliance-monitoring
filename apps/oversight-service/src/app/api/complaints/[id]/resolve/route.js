import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { resolveComplaint } from '../../../../../modules/complaints/handling.js';

export const dynamic = 'force-dynamic';
const canHandle = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]);

// POST /complaints/:id/resolve { reply }: the written reply is required.
export const POST = route(async (request, { params }) => {
  const user = await canHandle(request);
  return json(await resolveComplaint(await getDb(), user, params.id, await readJson(request)), 200, { 'cache-control': 'no-store' });
});
