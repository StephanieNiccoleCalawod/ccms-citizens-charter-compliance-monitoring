import { buildErrorBody, clientIp, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { OPERATOR_ROLES } from '../../../../modules/transaction/access.js';
import { runRegistrySearch } from '../../../../modules/registry/lookup.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Office Staff, Office Head and Super Admin. Executive: 403.
const canSearch = requirePermission(OPERATOR_ROLES, 'campus');
const NO_STORE = { 'cache-control': 'no-store, private' };

// GET /registry/search?q=&status= (CC044) — through the gateway: /api/operations/registry/search.
// Never cached; the search text is not logged here or written to the audit trail (J13(a)).
export const GET = route(async (request, { correlationId }) => {
  const actor = await canSearch(request);
  const result = await runRegistrySearch(await getDb(), actor, new URL(request.url).searchParams, { ipAddress: clientIp(request) });
  if (result.limited) {
    const seconds = result.limited.retryAfterSeconds;
    return json(
      buildErrorBody({ code: 'RATE_LIMITED', message: `Too many registry searches. Try again in ${seconds} seconds.`, correlationId }),
      429,
      { ...NO_STORE, 'retry-after': String(seconds) },
    );
  }
  return json({ items: result.items }, 200, NO_STORE);
});
