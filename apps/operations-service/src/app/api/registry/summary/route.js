import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { getRegistrySummary } from '../../../../modules/registry/imports.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN]);

export const GET = route(async (request) => {
  await canRead(request);
  return json(await getRegistrySummary(await getDb()));
});
