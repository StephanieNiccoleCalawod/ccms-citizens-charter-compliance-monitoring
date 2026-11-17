import { ROLES, json, route } from 'ccms-shared';
import { findClerkUserForAccount } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../../lib/clerk.js';
import * as directoryLookup from '../../../../../lib/clerk-directory.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /accounts/{id}/clerk-match — Super Admin only (Flow B, step 1): the Clerk logins whose VERIFIED email is exactly this
// account's email. Read only; nothing is bound. 404 unless Clerk sign-in and the directory (CLERK_DIRECTORY_ENABLED) are on.
export const GET = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const directory = directoryLookup.requireDirectory(directoryLookup.directorySettings());
  await superAdminOnly(request);
  return json(await findClerkUserForAccount(await getDb(), params.id, settings, directory, directoryLookup), 200, { 'cache-control': 'no-store' });
});
