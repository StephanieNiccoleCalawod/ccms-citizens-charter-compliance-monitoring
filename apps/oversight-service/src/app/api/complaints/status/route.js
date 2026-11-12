import { json, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { complaintStatus, limitRequest } from '../../../../modules/complaints/complaints.js';

export const dynamic = 'force-dynamic';

// GET /complaints/status?ref=: public; only the status of one reference; rate limited.
export const GET = route(async (request, { correlationId }) => {
  const limited = await limitRequest(request, correlationId, 'status');
  if (limited) return limited;
  return json(await complaintStatus(await getDb(), new URL(request.url).searchParams.get('ref')), 200, { 'cache-control': 'no-store' });
});
