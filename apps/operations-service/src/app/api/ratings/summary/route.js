import { ROLE_LIST, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { ratingSummary } from '../../../../modules/ratings/ratings.js';

export const dynamic = 'force-dynamic';

// CC057: GET /ratings/summary - count and average per service. Every staff role may read; Office Head and Staff see their own office only.
const canRead = requirePermission(ROLE_LIST);
export const GET = route(async (request) => json(await ratingSummary(await getDb(), await canRead(request), new URL(request.url).searchParams), 200, { 'cache-control': 'private, no-store' }));
