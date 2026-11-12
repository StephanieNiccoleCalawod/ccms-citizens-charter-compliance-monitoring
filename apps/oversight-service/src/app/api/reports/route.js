import { ROLES, json, readJson, requirePermission, route } from 'ccms-shared';
import { requireStaffSwitch } from '../../../lib/switches.js';
import { getDb } from '../../../lib/data-source.js';
import { generateReport, listReports } from '../../../modules/reports/reports.js';

export const dynamic = 'force-dynamic';

// Office Staff may read only while the Super Admin's switch STAFF_VIEW_REPORTS is on (CC056); they never generate or publish.
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
const canGenerate = requirePermission([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]);

export const GET = route(async (request) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_REPORTS');
  return json(await listReports(await getDb(), user, new URL(request.url).searchParams), 200, { 'cache-control': 'no-store' });
});

export const POST = route(async (request) => {
  const user = await canGenerate(request);
  const report = await generateReport(await getDb(), user, await readJson(request), { authorization: request.headers.get('authorization') });
  return json(report, 200, { 'cache-control': 'no-store' });
});
