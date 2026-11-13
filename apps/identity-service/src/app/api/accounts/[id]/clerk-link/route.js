import { ROLES, clientIp, json, noContent, readJson, route } from 'ccms-shared';
import { linkAccount, unlinkAccount } from '../../../../../lib/clerk-access.js';
import { clerkSettings, requireClerkEnabled } from '../../../../../lib/clerk.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// PUT /accounts/{id}/clerk-link { clerk_user_id } — Super Admin only: bind the account to a person from the pending sign-ins.
export const PUT = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const user = await superAdminOnly(request);
  const link = await linkAccount(await getDb(), user, params.id, await readJson(request), settings, { ipAddress: clientIp(request) });
  return json(link, 200, { 'cache-control': 'no-store' });
});

// DELETE /accounts/{id}/clerk-link — Super Admin only: remove the binding (CCMS only; not your own).
export const DELETE = route(async (request, { params }) => {
  const settings = requireClerkEnabled(clerkSettings());
  const user = await superAdminOnly(request);
  await unlinkAccount(await getDb(), user, params.id, settings, { ipAddress: clientIp(request) });
  return noContent({ 'cache-control': 'no-store' });
});
