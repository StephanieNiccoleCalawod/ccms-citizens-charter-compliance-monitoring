import { ROLES, clientIp, json, readJson, route } from 'ccms-shared';
import { decideRequest } from '../../../../../lib/access-requests.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// POST /access-requests/:id/decision { decision: 'GRANT' | 'DENY', ends_on?, note? } — Super Admin only; never their own request.
export const POST = route(async (request, { params }) => {
  const user = await superAdminOnly(request);
  return json({ request: await decideRequest(await getDb(), user, params.id, await readJson(request), { ipAddress: clientIp(request) }) });
});
