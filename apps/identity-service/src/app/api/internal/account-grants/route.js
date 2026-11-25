import { json, requireServiceKey, route } from 'ccms-shared';
import { activeGrantsFor } from '../../../../lib/access-requests.js';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// GET /internal/account-grants?account_id= — service-to-service only (x-service-key; the gateway never forwards /api/internal).
// Operations and Oversight ask it, keep the answer for at most 10 seconds, and treat an unreachable Identity as "no grants".
export const GET = route(async (request) => {
  requireServiceKey(request);
  return json(await activeGrantsFor(await getDb(), new URL(request.url).searchParams.get('account_id')), 200, { 'cache-control': 'no-store' });
});
