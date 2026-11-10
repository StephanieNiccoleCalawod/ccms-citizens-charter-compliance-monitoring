import { Errors, ROLES, clientIp, isUuid, json, readJson, requirePermission, route } from 'ccms-shared';
import { getOfficeSchedule, resetOfficeSchedule, updateOfficeSchedule } from '../../../../../lib/calendar/office-schedule.js';
import { getDb } from '../../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// CC048: an office's own working days and hours.
//   Read:  Super Admin and Executive (any office), Office Head (their own office only). Office Staff and the rest: 403.
//   Write: Super Admin only (an Office Head or Executive asking to change it gets 403).
// The weekly schedule of an office is never sent to FMS or SCMS.
const canRead = requirePermission([ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD], 'office');
const canWrite = requirePermission([ROLES.SUPER_ADMIN], 'office');

function officeIdOf(params) {
  if (!isUuid(params.id)) throw Errors.notFound('Office not found', 'OFFICE_NOT_FOUND');
  return params.id;
}

// GET /offices/:id/schedule -> { office_id, uses_campus_schedule, version, items: [7 days, Sunday first] }
// `items` is the schedule that applies to the office: its own, or the campus schedule while it has none.
export const GET = route(async (request, { params }) => {
  const id = officeIdOf(params);
  await canRead(request, { officeId: id });
  return json(await getOfficeSchedule(await getDb(), id));
});

// PUT /offices/:id/schedule { version, days: [7 items] } -> the saved schedule. A stale version is a 409.
export const PUT = route(async (request, { params }) => {
  const id = officeIdOf(params);
  const user = await canWrite(request, { officeId: id });
  return json(await updateOfficeSchedule(await getDb(), user, id, await readJson(request), { ipAddress: clientIp(request) }));
});

// DELETE /offices/:id/schedule?version=N -> the office goes back to the campus schedule. A stale version is a 409.
export const DELETE = route(async (request, { params }) => {
  const id = officeIdOf(params);
  const user = await canWrite(request, { officeId: id });
  const raw = new URL(request.url).searchParams.get('version');
  const version = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return json(await resetOfficeSchedule(await getDb(), user, id, { version, ipAddress: clientIp(request) }));
});
