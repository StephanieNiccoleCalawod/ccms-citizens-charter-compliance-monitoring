import { isUuid, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { OPERATOR_ROLES, assertCanAccess } from '../../../../../modules/transaction/access.js';
import { loadTransactionRow, notFound } from '../../../../../modules/transaction/db.js';
import { formatCode, ratingCodeFor } from '../../../../../modules/ratings/ratings.js';

export const dynamic = 'force-dynamic';

const canUse = requirePermission(OPERATOR_ROLES, 'campus');

// CC057: GET /transactions/:id/rating-code - the code staff hand to a citizen who has no email (also printed on the receipt email).
// Same scope as completing the transaction (the Executive: 403). Only a completed transaction has one.
export const GET = route(async (request, { params }) => {
  const user = await canUse(request);
  if (!isUuid(params.id)) throw notFound();
  const row = await loadTransactionRow(await getDb(), params.id);
  if (!row) throw notFound();
  assertCanAccess(user, row);
  const found = await ratingCodeFor(await getDb(), params.id);
  return json({ code: found ? formatCode(found.code) : null, used: found?.used ?? false }, 200, { 'cache-control': 'private, no-store' });
});
