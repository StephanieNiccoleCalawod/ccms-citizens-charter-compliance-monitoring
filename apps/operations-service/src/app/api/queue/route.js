import { json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { QUEUE_ROLES, getQueueBoard } from '../../../modules/queue/tickets.js';

export const dynamic = 'force-dynamic';

// CC039: GET /queue?office_id= - today's queue of one office (called tickets, then the waiting line in call order).
// Office Head / Office Staff: their own office (office_id may be left out); Super Admin: any office, office_id required.
// Executive: 403. Also the source of the CC040 ticket picker.
const canUse = requirePermission(QUEUE_ROLES);

export const GET = route(async (request) => {
  const actor = await canUse(request);
  return json(await getQueueBoard(await getDb(), { now: () => new Date() }, actor, new URL(request.url).searchParams), 200, { 'cache-control': 'no-store' });
});
