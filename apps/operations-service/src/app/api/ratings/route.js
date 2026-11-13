import { json, readJson, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { limitRatingRequest } from '../../../modules/ratings/limit.js';
import { rateWithCode } from '../../../modules/ratings/ratings.js';

export const dynamic = 'force-dynamic';

// CC057: POST /ratings { code, stars } - public (no account), rate limited per client address. One use per code; no free text.
export const POST = route(async (request, { correlationId }) => {
  const limited = await limitRatingRequest(request, correlationId);
  if (limited) return limited;
  return json(await rateWithCode(await getDb(), await readJson(request)), 201, { 'cache-control': 'no-store' });
});
