import { ROLES, requirePermission, route } from 'ccms-shared';
import { requireStaffSwitch } from '../../../../../lib/switches.js';
import { getDb } from '../../../../../lib/data-source.js';
import { reportToCsv } from '../../../../../modules/reports/csv.js';
import { fetchReport } from '../../../../../modules/reports/reports.js';

export const dynamic = 'force-dynamic';
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);

// GET /reports/:id/export.csv: UTF-8 with a byte-order mark, one row per service plus a total row, MM/DD/YYYY.
export const GET = route(async (request, { params }) => {
  const user = await canRead(request);
  await requireStaffSwitch(user, 'STAFF_VIEW_REPORTS');
  const report = await fetchReport(await getDb(), user, params.id);
  const name = `report-${report.from}-to-${report.to}-v${report.version}.csv`;
  return new Response(reportToCsv(report), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
});
