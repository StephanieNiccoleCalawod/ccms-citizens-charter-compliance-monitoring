import { Errors, ROLES, isUuid, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { retrainForecast } from '../../../../../lib/forecast/forecast-service.js';

export const dynamic = 'force-dynamic';

// Only Super Admin may trigger a manual retrain.
const canRetrain = requirePermission([ROLES.SUPER_ADMIN], 'campus');

/**
 * POST /analytics/forecast/retrain
 * Body: { officeId, serviceId? }
 *
 * Recomputes a fresh forecast for the given scope, persists a new forecast_run row,
 * and returns the result. Previous runs are kept.
 */
export const POST = route(async (request) => {
  await canRetrain(request);
  const body = await readJson(request);

  const officeId  = typeof body.officeId === 'string' ? body.officeId.trim() : null;
  const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : null;

  if (!officeId) throw Errors.validation('officeId is required', { officeId: 'officeId is required' });
  if (!isUuid(officeId)) throw Errors.validation('officeId must be a valid UUID', { officeId: 'officeId must be a valid UUID' });
  if (serviceId && !isUuid(serviceId)) throw Errors.validation('serviceId must be a valid UUID', { serviceId: 'serviceId must be a valid UUID' });

  const run = await retrainForecast(await getDb(), { officeId, serviceId: serviceId || null });
  return json(run, 200, { 'cache-control': 'private, no-store' });
});
