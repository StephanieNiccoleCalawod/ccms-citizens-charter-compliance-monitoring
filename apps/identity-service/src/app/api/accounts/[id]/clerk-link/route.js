import { ROLES, clientIp, json, noContent, readJson, route } from 'ccms-shared';
import { linkAccount, linkAccountFromDirectory, unlinkAccount } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../../lib/clerk.js';
import * as directoryLookup from '../../../../../lib/clerk-directory.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// PUT /accounts/{id}/clerk-link — Super Admin only: bind the account to a Clerk user.
//   { clerk_user_id }                       a person from the pending sign-ins (they signed in once)
//   { clerk_user_id, via: "directory" }     Flow B: a person found in Clerk by the account's email (clerk-match); Clerk is
//                                           asked again and the verified email must equal the account's email
export const PUT = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const user = await superAdminOnly(request);
  const body = await readJson(request);
  const db = await getDb();
  const options = { ipAddress: clientIp(request) };
  if (body?.via === 'directory') {
    const directory = directoryLookup.requireDirectory(directoryLookup.directorySettings());
    return json(await linkAccountFromDirectory(db, user, params.id, body, settings, directory, directoryLookup, options), 200, { 'cache-control': 'no-store' });
  }
  return json(await linkAccount(db, user, params.id, body, settings, options), 200, { 'cache-control': 'no-store' });
});

// DELETE /accounts/{id}/clerk-link — Super Admin only: remove the binding (CCMS only; not your own).
export const DELETE = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const user = await superAdminOnly(request);
  await unlinkAccount(await getDb(), user, params.id, settings, { ipAddress: clientIp(request) });
  return noContent({ 'cache-control': 'no-store' });
});
