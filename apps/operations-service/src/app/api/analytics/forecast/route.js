import { Errors, ROLE_LIST, assertOfficeAccess, isUuid, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readForecast } from '../../../../lib/forecast/forecast-service.js';

export const dynamic = 'force-dynamic';

// All four roles may read the forecast; office-bound roles are restricted to their own office (case-insensitive UUID check).
const canRead = requirePermission(ROLE_LIST, 'campus');

/**
 * GET /analytics/forecast?officeId=&serviceId=
 *
 * Serves today's valid stored run (by Manila calendar date) if available, otherwise recomputes
 * on demand. If Core/calendar fails during recomputation and a prior non-error stored run exists,
 * returns that stored fallback explicitly marked stale: true instead of presenting it as today's run.
 */
export const GET = route(async (request) => {
  const user = await canRead(request);
  const params = new URL(request.url).searchParams;

  const officeId  = params.get('officeId')?.trim() || null;
  const serviceId = params.get('serviceId')?.trim() || null;

  if (!officeId) throw Errors.validation('officeId is required', { officeId: 'officeId is required' });
  if (!isUuid(officeId)) throw Errors.validation('officeId must be a valid UUID', { officeId: 'officeId must be a valid UUID' });
  if (serviceId && !isUuid(serviceId)) throw Errors.validation('serviceId must be a valid UUID', { serviceId: 'serviceId must be a valid UUID' });

  assertOfficeAccess(user, officeId);

  const run = await readForecast(await getDb(), { officeId, serviceId });
  return json(run, 200, { 'cache-control': 'private, no-store' });
});
