import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { listOperationsNotifications } from '../../../modules/notifications/notifications.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// CC055: Super Admin (with ?officeId=), Office Head and Office Staff. The Executive has no bell (403).
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const GET = route(async (request) => {
  const user = await canRead(request);
  return json(await listOperationsNotifications(await getDb(), user, { officeId: new URL(request.url).searchParams.get('officeId') }), 200, { 'cache-control': 'private, no-store' });
});
