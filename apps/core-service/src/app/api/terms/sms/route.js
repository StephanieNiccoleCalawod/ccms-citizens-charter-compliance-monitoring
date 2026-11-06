import { ROLE_LIST, json, requirePermission, route } from 'ccms-shared';
import { readTermsForScreen } from '../../../../lib/calendar/sms-terms-client.js';

export const dynamic = 'force-dynamic';

const canRead = requirePermission(ROLE_LIST, 'campus');

// GET /terms/sms - any signed-in user. The academic terms SMS owns, for the read-only Academic terms tab.
// { enabled, state, items }; enabled=false while SMS_TERMS_ENABLED is not true.
export const GET = route(async (request) => {
  await canRead(request);
  return json(await readTermsForScreen(), 200, { 'cache-control': 'no-store' });
});
