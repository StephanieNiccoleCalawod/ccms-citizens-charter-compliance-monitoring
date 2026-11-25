import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { deleteNotifications } from '../../../../../modules/notifications/notifications.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const POST = route(async (request) => {
  const user = await canRead(request);
  return json(await deleteNotifications(await getDb(), user, await readJson(request)), 200, { 'cache-control': 'no-store' });
});
