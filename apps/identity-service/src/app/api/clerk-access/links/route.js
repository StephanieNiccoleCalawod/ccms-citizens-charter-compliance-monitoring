import { ROLES, json, route } from 'ccms-shared';
import { listLinks } from '../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../lib/clerk.js';
import { getDb } from '../../../../lib/data-source.js';
import { guard } from '../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /clerk-access/links — Super Admin only: which accounts can sign in with Clerk (for the Accounts screen).
export const GET = route(async (request) => {
  const settings = requireClerkEnabled(clerkSettings());
  await superAdminOnly(request);
  return json(await listLinks(await getDb(), settings), 200, { 'cache-control': 'no-store' });
});
