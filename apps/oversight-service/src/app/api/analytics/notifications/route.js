import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { listNotifications } from '../../../../modules/notifications/notifications.js';

export const dynamic = 'force-dynamic';
// CC055: Super Admin, Office Head, Office Staff. The Executive has no bell (403).
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const GET = route(async (request) => json(await listNotifications(await getDb(), await canRead(request)), 200, { 'cache-control': 'private, no-store' }));
