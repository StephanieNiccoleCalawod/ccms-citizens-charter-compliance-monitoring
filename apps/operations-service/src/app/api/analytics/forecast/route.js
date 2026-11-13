import { Errors, ROLES, ROLE_LIST, isUuid, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { createCalendarClient } from '../../../../lib/forecast/calendar-client.js';
import { buildHistorySeries } from '../../../../lib/forecast/aggregator.js';
import { computeForecast, getLatestForecastRun, saveForecastRun } from '../../../../lib/forecast/forecast-service.js';

export const dynamic = 'force-dynamic';

// All four roles may read the forecast; office-bound roles are restricted to their own office.
const canRead = requirePermission(ROLE_LIST, 'campus');

/**
 * GET /analytics/forecast?officeId=&serviceId=
 *
 * Returns the latest stored forecast run if one exists and was generated today, otherwise
 * computes a fresh forecast on the fly (for manual retrain it goes through the POST endpoint).
 *
 * This endpoint computes fresh on every call during the sprint (the nightly job pre-caches;
 * the API falls back to compute on demand so Super Admin "retrain" is not the only way to get a result).
 */
export const GET = route(async (request) => {
  const user = await canRead(request);
  const params = new URL(request.url).searchParams;

  const officeId  = params.get('officeId')?.trim() || null;
  const serviceId = params.get('serviceId')?.trim() || null;

  if (!officeId) throw Errors.validation('officeId is required', { officeId: 'officeId is required' });
  if (!isUuid(officeId)) throw Errors.validation('officeId must be a valid UUID', { officeId: 'officeId must be a valid UUID' });
  if (serviceId && !isUuid(serviceId)) throw Errors.validation('serviceId must be a valid UUID', { serviceId: 'serviceId must be a valid UUID' });

  // RBAC: office-bound roles may only see their own office
  if ((user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF) &&
      String(officeId) !== String(user.officeId)) {
    throw Errors.forbidden();
  }

  const db = await getDb();

  // Try to serve from the latest stored run (computed today by the nightly job or a previous on-demand call)
  const stored = await getLatestForecastRun(db, officeId, serviceId ?? null);
  if (stored) {
    const run = formatStoredRun(stored);
    run.history = await recentHistory(db, { officeId, serviceId });
    return json(run);
  }

  // No stored run → compute on demand
  const calClient = createCalendarClient();
  const result = await computeForecast(db, calClient, { officeId, serviceId });
  await saveForecastRun(db, result);
  return json(formatResult(result));
});

/**
 * A stored run does not keep the daily counts, and the Insights page (CC053, sentence 1) compares the forecast with the last 5
 * working days. The counts are read again here, cheaply; if Core cannot be reached the run is still served, with no history.
 */
async function recentHistory(db, { officeId, serviceId }) {
  try {
    const { dates, counts } = await buildHistorySeries(db, createCalendarClient(), { officeId, serviceId, maxWorkingDays: 30 });
    return dates.map((date, i) => ({ date, count: counts[i] }));
  } catch {
    return [];
  }
}

function formatStoredRun(row) {
  return {
    status: row.status,
    scope: { officeId: row.office_id, serviceId: row.service_id ?? null },
    history: [], // not persisted in the run; filled in by recentHistory() on read
    forecast: Array.isArray(row.forecast_payload) ? row.forecast_payload : (row.forecast_payload ?? []),
    weeklyTotal: row.weekly_total ?? 0,
    model: { name: row.selected_model, mae: row.mae != null ? Number(row.mae) : null },
    historyWorkingDays: row.history_working_days ?? 0,
    historicalTransactionCount: row.historical_transaction_count ?? 0,
    historyStartDate: row.history_start_date ?? null,
    historyEndDate:   row.history_end_date ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    generatedAt: row.generated_at,
  };
}

function formatResult(result) {
  return {
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
  };
}
