import { ROLES, json, route } from 'ccms-shared';
import { guard } from '../../../lib/guard.js';
import { policyView } from '../../../lib/session-policy.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /session-policy: Super Admin only, read-only. The idle and absolute limits enforced for each role (S8-34).
export const GET = route(async (request) => {
  await superAdminOnly(request);
  return json(policyView(), 200, { 'cache-control': 'no-store' });
});
