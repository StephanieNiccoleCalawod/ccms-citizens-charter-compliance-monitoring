import { json, requirePermission, route } from 'ccms-shared';
import { readOptionalJson } from '../../../../modules/transaction/http.js';
import { getDb } from '../../../../lib/data-source.js';
import { runtimeDeps } from '../../../../modules/transaction/deps.js';
import { QUEUE_ROLES, issueTicketAsStaff } from '../../../../modules/queue/tickets.js';

export const dynamic = 'force-dynamic';

// CC039: POST /queue/tickets { office_id?, priority_group? } - staff issuance from the queue panel. Same sequence and code as
// the public page; the office is checked against the caller's scope on the server.
const canUse = requirePermission(QUEUE_ROLES);

export const POST = route(async (request) => {
  const actor = await canUse(request);
  return json(await issueTicketAsStaff(await getDb(), runtimeDeps(), actor, await readOptionalJson(request)), 201, { 'cache-control': 'no-store' });
});
