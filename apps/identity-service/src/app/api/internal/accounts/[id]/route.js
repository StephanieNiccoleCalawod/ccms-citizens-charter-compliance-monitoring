import { Errors, isUuid, json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { Account } from '../../../../../lib/entities/index.js';

export const dynamic = 'force-dynamic';

// GET /internal/accounts/:id — service-to-service only (x-service-key). Operations copies the starter's position and display
// name from here at Start (CC046), so a transaction keeps both as they were. Returns those two and nothing else about the
// person (no email, role, office or password data). The gateway never forwards /api/internal.
export const GET = route(async (request, { params }) => {
  requireServiceKey(request);
  const { id } = await params;
  if (!isUuid(id)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const account = await (await getDb()).getRepository(Account).findOneBy({ accountId: id });
  if (!account) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  return json({ account_id: account.accountId, full_name: account.fullName, position: account.position ?? null });
});
