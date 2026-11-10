import { Errors, ROLES, isUuid, json, readJson, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { createCalendarClient } from '../../../../../lib/forecast/calendar-client.js';
import { computeForecast, saveForecastRun } from '../../../../../lib/forecast/forecast-service.js';

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

  const db = await getDb();
  const calClient = createCalendarClient();
  const result = await computeForecast(db, calClient, { officeId, serviceId: serviceId || null });
  await saveForecastRun(db, result);

  return json({
    status: result.status,
    scope: { officeId: result.officeId, serviceId: result.serviceId ?? null },
    history: result.history,
    forecast: result.forecast,
    weeklyTotal: result.weeklyTotal,
    model: { name: result.model, mae: result.mae },
    historyWorkingDays: result.historyWorkingDays,
    historicalTransactionCount: result.historicalTransactionCount,
    historyStartDate: result.historyStartDate ?? null,
    historyEndDate:   result.historyEndDate ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    generatedAt: result.generatedAt,
  }, 200);
});
