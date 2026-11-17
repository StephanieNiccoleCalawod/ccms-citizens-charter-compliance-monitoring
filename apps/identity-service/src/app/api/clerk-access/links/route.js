import { ROLES, json, route } from 'ccms-shared';
import { listLinks } from '../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../lib/clerk.js';
import { directoryAvailable, invitationsAvailable } from '../../../../lib/clerk-directory.js';
import { getDb } from '../../../../lib/data-source.js';
import { guard } from '../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /clerk-access/links — Super Admin only: which accounts can sign in with Clerk (active or deactivated), whether Flow B
// (find a person in Clerk by the account's email) and Flow A (send a Clerk invitation) are switched on, and the accounts with
// an open invitation.
export const GET = route(async (request) => {
  const settings = requireClerkEnabled(clerkSettings());
  await superAdminOnly(request);
  const options = { directory: directoryAvailable(), invitations: invitationsAvailable() };
  return json(await listLinks(await getDb(), settings, options), 200, { 'cache-control': 'no-store' });
});
