import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { startNewVersion } from '../../../../../modules/reports/reports.js';

export const dynamic = 'force-dynamic';
const canCorrect = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]);

export const POST = route(async (request, { params }) => {
  const user = await canCorrect(request);
  const report = await startNewVersion(await getDb(), user, params.id, await readJson(request), { authorization: request.headers.get('authorization') });
  return json(report, 201, { 'cache-control': 'no-store' });
});
