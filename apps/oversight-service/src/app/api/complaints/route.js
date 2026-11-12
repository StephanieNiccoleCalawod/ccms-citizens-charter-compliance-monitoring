import { json, readJson, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { fileComplaint, limitRequest } from '../../../modules/complaints/complaints.js';

export const dynamic = 'force-dynamic';

// POST /complaints: public, no account, no CAPTCHA (DV-04); rate limited per client address.
export const POST = route(async (request, { correlationId }) => {
  const limited = await limitRequest(request, correlationId, 'file');
  if (limited) return limited;
  return json(await fileComplaint(await getDb(), await readJson(request)), 201, { 'cache-control': 'no-store' });
});
