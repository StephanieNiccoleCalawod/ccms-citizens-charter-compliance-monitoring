import { json, readJson, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { runtimeDeps } from '../../../../../modules/transaction/deps.js';
import { limitTicketRequest } from '../../../../../modules/queue/limit.js';
import { issueTicket, parseIssueInput } from '../../../../../modules/queue/tickets.js';

export const dynamic = 'force-dynamic';

// CC039: POST /queue/public/tickets { office_id, priority_group? } - "Take a ticket" without an account (public through the
// gateway). Rate limited per client address before anything is read or allocated; no personal detail is accepted.
export const POST = route(async (request, { correlationId }) => {
  const limited = await limitTicketRequest(request, correlationId);
  if (limited) return limited;
  const input = parseIssueInput(await readJson(request));
  const ticket = await issueTicket(await getDb(), runtimeDeps(), { officeId: input.officeId, lane: input.lane, actor: null });
  return json(ticket, 201, { 'cache-control': 'no-store' });
});
