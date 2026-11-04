import { ROLES, clientIp, json, route } from 'ccms-shared';
import { requestPasswordReset } from '../../../../../lib/accounts.js';
import { getDb } from '../../../../../lib/data-source.js';
import { guard } from '../../../../../lib/guard.js';

export const dynamic = 'force-dynamic';

const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// POST /accounts/:id/reset-password — Super Admin only. Emails a time-limited reset link to the
// account's registered address. Self-service reset (ARMS BR-06) is a PM decision, not built.
export const POST = route(async (request, { params }) => {
  const user = await superAdminOnly(request);
  const result = await requestPasswordReset(await getDb(), user, params.id, { ipAddress: clientIp(request) });
  return json({ message: `A reset link was emailed to ${result.email}.`, expires_at: result.expires_at });
});
