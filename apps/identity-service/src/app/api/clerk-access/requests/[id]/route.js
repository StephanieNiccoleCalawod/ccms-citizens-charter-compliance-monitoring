import { ROLES, noContent, route } from 'ccms-shared';
import { dismissAccessRequest } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../../lib/clerk.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// DELETE /clerk-access/requests/{clerk user id} — Super Admin only: dismiss a pending sign-in. No access was given.
export const DELETE = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  await superAdminOnly(request);
  await dismissAccessRequest(await getDb(), params.id, settings);
  return noContent({ 'cache-control': 'no-store' });
});
