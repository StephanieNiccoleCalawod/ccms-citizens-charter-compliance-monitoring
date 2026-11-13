import { ROLES, json, route } from 'ccms-shared';
import { listAccessRequests } from '../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../lib/clerk.js';
import { getDb } from '../../../../lib/data-source.js';
import { guard } from '../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /clerk-access/requests — Super Admin only: people who signed in with Clerk and have no CCMS access yet.
export const GET = route(async (request) => {
  const settings = requireClerkEnabled(clerkSettings());
  await superAdminOnly(request);
  return json(await listAccessRequests(await getDb(), settings), 200, { 'cache-control': 'no-store' });
});
