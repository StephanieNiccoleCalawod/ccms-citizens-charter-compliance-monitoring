import { ROLES, clientIp, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { requeueRejectedSync } from '../../../../../lib/calendar/sync.js';

export const dynamic = 'force-dynamic';
const canWrite = requirePermission([ROLES.SUPER_ADMIN], 'campus');

export const POST = route(async (request, { params }) => {
  const actor = await canWrite(request);
  return json(await requeueRejectedSync(await getDb(), actor, params.id, { ipAddress: clientIp(request) }));
});
