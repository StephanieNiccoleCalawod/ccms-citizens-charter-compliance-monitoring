import { json, route } from 'ccms-shared';
import { limitRequest } from '../../../../modules/complaints/complaints.js';
import { checkTrackingNumber } from '../../../../modules/complaints/tracking-check.js';

export const dynamic = 'force-dynamic';

// GET /complaints/tracking-check?tracking_no=: public (S8-56); only found / not found plus office, service and day; rate limited like the status check.
export const GET = route(async (request, { correlationId }) => {
  const limited = await limitRequest(request, correlationId, 'status');
  if (limited) return limited;
  const result = await checkTrackingNumber(new URL(request.url).searchParams.get('tracking_no'));
  return json(result, 200, { 'cache-control': 'no-store' });
});
