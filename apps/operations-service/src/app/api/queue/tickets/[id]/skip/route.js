import { json, requirePermission, route } from 'ccms-shared';
import { readOptionalJson } from '../../../../../../modules/transaction/http.js';
import { getDb } from '../../../../../../lib/data-source.js';
import { QUEUE_ROLES, skipTicket } from '../../../../../../modules/queue/tickets.js';

export const dynamic = 'force-dynamic';

// CC039: POST /queue/tickets/:id/skip { version? } - a no-show, allowed 3 minutes after the recorded call (409 before).
const canUse = requirePermission(QUEUE_ROLES);

export const POST = route(async (request, { params }) => {
  const actor = await canUse(request);
  return json(await skipTicket(await getDb(), { now: () => new Date() }, actor, params.id, await readOptionalJson(request)), 200, { 'cache-control': 'no-store' });
});
