import { Errors, isUuid, json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { Account } from '../../../../../lib/entities/index.js';

export const dynamic = 'force-dynamic';

// GET /internal/operators/:id — service-to-service only (x-service-key). Sprint 6 TT1: the historical-records import
// verifies the operator it records in its one summary audit entry independently, against Identity: the account must
// exist, be active and be a Super Admin. Returns the role and active flag only (no name, email or password data).
export const GET = route(async (request, { params }) => {
  requireServiceKey(request);
  const { id } = params;
  if (!isUuid(id)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const account = await (await getDb()).getRepository(Account).findOneBy({ accountId: id });
  if (!account) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  return json({ account_id: account.accountId, role: account.roleKey, is_active: account.isActive === true }, 200, { 'cache-control': 'no-store' });
});
