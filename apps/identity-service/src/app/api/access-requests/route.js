import { ROLES, clientIp, json, readJson, route } from 'ccms-shared';
import { createRequest, listRequests } from '../../../lib/access-requests.js';
import { getDb } from '../../../lib/data-source.js';
import { guard } from '../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const canList = guard([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
const canRequest = guard([ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

// GET /access-requests?status= — Super Admin: every request. Office Head / Office Staff: their own.
export const GET = route(async (request) => {
  const user = await canList(request);
  return json(await listRequests(await getDb(), user, new URL(request.url).searchParams), 200, { 'cache-control': 'no-store' });
});

// POST /access-requests { permission_key, reason } — Office Head / Office Staff, for one of the four grantable permissions (D-AC-4).
export const POST = route(async (request) => {
  const user = await canRequest(request);
  return json({ request: await createRequest(await getDb(), user, await readJson(request), { ipAddress: clientIp(request) }) }, 201);
});
