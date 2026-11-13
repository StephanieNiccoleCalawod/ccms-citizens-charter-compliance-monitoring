import { json, requirePermission, route } from 'ccms-shared';
import { readOptionalJson } from '../../../../modules/transaction/http.js';
import { getDb } from '../../../../lib/data-source.js';
import { QUEUE_ROLES, callNextTicket } from '../../../../modules/queue/tickets.js';

export const dynamic = 'force-dynamic';

// CC039: POST /queue/call-next { office_id? } -> { queue_empty, ticket } (ticket null when nobody is waiting).
const canUse = requirePermission(QUEUE_ROLES);

export const POST = route(async (request) => {
  const actor = await canUse(request);
  return json(await callNextTicket(await getDb(), { now: () => new Date() }, actor, await readOptionalJson(request)), 200, { 'cache-control': 'no-store' });
});
