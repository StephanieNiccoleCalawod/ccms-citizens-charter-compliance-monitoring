import { ROLES, json, route } from 'ccms-shared';
import { listActiveGrants } from '../../../lib/access-requests.js';
import { getDb } from '../../../lib/data-source.js';
import { guard } from '../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /access-grants — Super Admin only: who has extra access right now, until when and why.
export const GET = route(async (request) => {
  const user = await superAdminOnly(request);
  return json(await listActiveGrants(await getDb(), user), 200, { 'cache-control': 'no-store' });
});
