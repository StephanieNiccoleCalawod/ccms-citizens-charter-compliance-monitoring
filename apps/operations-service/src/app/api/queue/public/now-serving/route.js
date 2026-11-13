import { json, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { limitNowServingRequest, publicNowServing } from '../../../../../modules/queue/now-serving.js';

export const dynamic = 'force-dynamic';

// CC059: GET /queue/public/now-serving?office_id= - public (no account), read-only, rate limited per client address. Display numbers only.
export const GET = route(async (request, { correlationId }) => {
  const limited = await limitNowServingRequest(request, correlationId);
  if (limited) return limited;
  return json(await publicNowServing(await getDb(), new URL(request.url).searchParams), 200, { 'cache-control': 'no-store' });
});
