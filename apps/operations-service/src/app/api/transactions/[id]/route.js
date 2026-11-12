import { json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { TRANSACTION_READ_ROLES } from '../../../../modules/transaction/access.js';
import { getTransaction } from '../../../../modules/transaction/list.js';

export const dynamic = 'force-dynamic';

// Read-only: operators within their scope, and Executive for any office with the allowlisted view (CC027 / K14).
// This path has no write method; every write is its own route and still refuses Executive.
const canRead = requirePermission(TRANSACTION_READ_ROLES, 'campus');

// GET /transactions/:id — outside the caller's scope: 403 and no data.
export const GET = route(async (request, { params }) => {
  const user = await canRead(request);
  return json(await getTransaction(await getDb(), user, params.id));
});
