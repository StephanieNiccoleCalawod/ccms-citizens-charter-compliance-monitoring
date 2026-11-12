import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { requireStaffSwitch } from '../../../lib/switches.js';
import { fileComplaint, limitRequest } from '../../../modules/complaints/complaints.js';
import { listComplaints } from '../../../modules/complaints/handling.js';

export const dynamic = 'force-dynamic';

// POST /complaints: public, no account, no CAPTCHA (DV-04); rate limited per client address.
export const POST = route(async (request, { correlationId }) => {
  const limited = await limitRequest(request, correlationId, 'file');
  if (limited) return limited;
  return json(await fileComplaint(await getDb(), await readJson(request)), 201, { 'cache-control': 'no-store' });
});

// GET /complaints (CC034 / CC035): a signed-in person's list. Super Admin and Executive: all offices (the Executive reads only); Office Head:
// own office; Office Staff: own office, only while the switch STAFF_VIEW_COMPLAINTS is on. The gateway lets this path through without a token
// (it is also the public filing path), so this route checks the token itself: no token is a 401 here.
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const GET = route(async (request) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_COMPLAINTS');
  return json(await listComplaints(await getDb(), user, new URL(request.url).searchParams), 200, { 'cache-control': 'no-store' });
});
