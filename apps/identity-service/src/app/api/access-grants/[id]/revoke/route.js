import { ROLES, clientIp, json, route } from 'ccms-shared';
import { revokeGrant } from '../../../../../lib/access-requests.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// POST /access-grants/:id/revoke — Super Admin only. The access stops at the next request (other services remember grants for 10 seconds).
export const POST = route(async (request, { params }) => {
  const user = await superAdminOnly(request);
  return json(await revokeGrant(await getDb(), user, params.id, { ipAddress: clientIp(request) }));
});
