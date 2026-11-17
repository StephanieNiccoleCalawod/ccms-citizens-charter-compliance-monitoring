import { ROLES, clientIp, json, route } from 'ccms-shared';
import { revokeClerkInvitation, sendClerkInvitation } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../../lib/clerk.js';
import * as directoryLookup from '../../../../../lib/clerk-directory.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// Flow A. Both answer 404 unless Clerk sign-in (CLERK_AUTH_ENABLED) and invitations (CLERK_INVITATIONS_ENABLED + key) are on.
// POST /accounts/{id}/clerk-invitation — Super Admin only: Clerk emails the person an invitation; their first sign-in links
// this account. 409 CLERK_USER_EXISTS when the email already has a Clerk login (use Flow B instead).
export const POST = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const invitations = directoryLookup.requireInvitations(directoryLookup.invitationSettings());
  const user = await superAdminOnly(request);
  const result = await sendClerkInvitation(await getDb(), user, params.id, settings, invitations, directoryLookup, { ipAddress: clientIp(request) });
  return json(result, 201, { 'cache-control': 'no-store' });
});

// DELETE /accounts/{id}/clerk-invitation — Super Admin only: revoke the account's open invitation (CCCMS's own only, R5).
export const DELETE = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const invitations = directoryLookup.requireInvitations(directoryLookup.invitationSettings());
  const user = await superAdminOnly(request);
  const result = await revokeClerkInvitation(await getDb(), user, params.id, settings, invitations, directoryLookup, { ipAddress: clientIp(request) });
  return json(result, 200, { 'cache-control': 'no-store' });
});
