import { ROLES, assertOfficeAccess, clientIp, json, readJson, route } from 'ccms-shared';
import { getAccount, updateAccount } from '../../../../lib/accounts.js';
import { getDb } from '../../../../lib/data-source.js';
import { guard } from '../../../../lib/guard.js';

export const dynamic = 'force-dynamic';

const canRead = guard([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE], 'office');
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /accounts/:id — Super Admin (any), Executive (read-only, any), Office Head (own office only).
export const GET = route(async (request, { params }) => {
  const user = await canRead(request);
  const account = await getAccount(await getDb(), params.id);
  assertOfficeAccess(user, account.office_id);
  return json({ account });
});

// PUT /accounts/:id — Super Admin only; the role/office rules are re-checked.
export const PUT = route(async (request, { params, correlationId }) => {
  const user = await superAdminOnly(request);
  const account = await updateAccount(await getDb(), user, params.id, await readJson(request), {
    ipAddress: clientIp(request),
    correlationId,
  });
  return json({ account });
});
