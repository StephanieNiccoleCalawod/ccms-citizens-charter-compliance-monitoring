import { Errors, ROLES, ROLE_LIST, isUuid, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readLateRisk } from '../../../../modules/analytics/late-risk.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const canRead = requirePermission(ROLE_LIST, 'campus');

export const GET = route(async (request) => {
  const user = await canRead(request);
  const officeId = new URL(request.url).searchParams.get('officeId');
  if (!isUuid(officeId)) throw Errors.validation('Select an office', { officeId: 'officeId must be a valid UUID' });
  if ([ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(user.role) && officeId.toLowerCase() !== user.officeId?.toLowerCase()) {
    throw Errors.forbidden();
  }
  return json(await readLateRisk(await getDb(), officeId.toLowerCase(), user), 200,
    { 'cache-control': 'private, no-store' });
});
