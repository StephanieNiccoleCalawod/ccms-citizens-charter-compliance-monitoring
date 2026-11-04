import { ROLES, clientIp, json, route } from 'ccms-shared';
import { setAccountActive } from '../../../../../lib/accounts.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';

const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// PATCH /accounts/:id/deactivate — Super Admin only. Revokes the account's refresh tokens.
export const PATCH = route(async (request, { params }) => {
  const user = await superAdminOnly(request);
  const account = await setAccountActive(await getDb(), user, params.id, false, { ipAddress: clientIp(request) });
  return json({ account });
});
