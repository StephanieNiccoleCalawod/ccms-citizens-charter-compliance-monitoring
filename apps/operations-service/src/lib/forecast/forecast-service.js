/**
 * Orchestrates one complete forecast run for a given scope (office or office+service).
 * Calls the aggregator, the calendar client, and the engine; persists the result to forecast_runs.
 *
 * Returns a ForecastResult object whose shape is what the API route renders.
 */

import { Errors, calculation, toManilaDate } from 'ccms-shared';
import { buildHistorySeries, countServiceTransactions } from './aggregator.js';
import { CoreCalendarError, createCalendarClient } from './calendar-client.js';
import { BACK_TEST, MIN_HISTORY, MIN_SERVICE_TXN, runForecastEngine } from './engine.js';

function forecastCalculation({ count, from, to, model, at, tooFew = false }) {
  return { forecast: calculation({
    shows: 'Expected requests for the next five working days, with an estimated range.',
    steps: model === 'NONE' ? ['Check that the office has at least 20 working days of history; a service also needs at least 40 all-time transactions.',
      'No forecast was fitted for this run; the status explains why. The record count is the available history, or the all-time count when service eligibility failed.'] : ['Count received requests by Manila working date; include zero-request working days and exclude today.',
      'Compare additive Holt-Winters with a five-working-day season against seasonal naive on the last five working days; choose the lower mean absolute error (Holt-Winters wins ties).',
      'Refit the winner on all selected history and forecast the next five working days.',
      'Add the 10th and 90th percentiles of back-test errors to each prediction; clamp the lower bound to zero and the upper bound to at least the prediction.'],
    count, from, to, method: model, at, source: 'transactions',
    basis: tooFew ? 'All-time office/service transaction count used only for the eligibility check; no model was fitted.' : 'Requests by start date on the selected working days in Asia/Manila.',
    parameters: { season_working_days: BACK_TEST, back_test_working_days: BACK_TEST,
      minimum_working_days: MIN_HISTORY, minimum_service_transactions: MIN_SERVICE_TXN,
      service_requires_both_minimums: true, range_percentiles: [10, 90] },
  }) };
}

/**
 * @param {import('typeorm').DataSource}  dataSource
 * @param {object}  calendarClient   createCalendarClient() instance
 * @param {{
 *   officeId: string,
 *   serviceId?: string|null,
 *   maxWorkingDays?: number,
 *   now?: Date,
 * }} opts
 * @returns {Promise<ForecastResult>}
 */
export async function computeForecast(dataSource, calendarClient, { officeId, serviceId = null, maxWorkingDays = 30, now = new Date() }) {
  const normOffice = String(officeId).toLowerCase();
  const normService = serviceId ? String(serviceId).toLowerCase() : null;

  // Service-level guard: too few total transactions means we can't forecast at service level
  if (normService) {
    const total = await countServiceTransactions(dataSource, normOffice, normService);
    if (total < MIN_SERVICE_TXN) {
      return {
        status: 'TOO_FEW',
        officeId: normOffice,
        serviceId: normService,
        errorCode: 'TOO_FEW',
        errorMessage: `Not enough transactions for a service forecast (needs ${MIN_SERVICE_TXN}, found ${total})`,
        history: [],
        forecast: [],
        weeklyTotal: 0,
        model: 'NONE',
        mae: null,
        historyWorkingDays: 0,
        historicalTransactionCount: total,
        historyStartDate: null,
        historyEndDate: null,
        generatedAt: now.toISOString(),
      };
    }
  }

  // Build working-day history
  const { dates, counts, totalTransactions } = await buildHistorySeries(dataSource, calendarClient, {
    officeId: normOffice,
    serviceId: normService,
    maxWorkingDays,
    now,
  });

  if (dates.length < MIN_HISTORY) {
    return {
      status: 'NOT_ENOUGH_HISTORY',
      officeId: normOffice,
      serviceId: normService,
      errorCode: 'NOT_ENOUGH_HISTORY',
      errorMessage: 'Not enough history yet (needs 4 weeks)',
      history: dates.map((d, i) => ({ date: d, count: counts[i] })),
      forecast: [],
      weeklyTotal: 0,
      model: 'NONE',
      mae: null,
      historyWorkingDays: dates.length,
      historicalTransactionCount: totalTransactions,
      historyStartDate: dates[0] ?? null,
      historyEndDate: dates.at(-1) ?? null,
      generatedAt: now.toISOString(),
    };
  }

  // Run the engine
  const engineResult = runForecastEngine(counts);

  // Get the next 5 working-day dates from Core
  const lastHistoryDate = dates.at(-1);
  const futureDates = await calendarClient.nextWorkingDays(lastHistoryDate, 5, normOffice);

  // Combine forecast points with dates
  const forecastPoints = engineResult.forecast.map((f, i) => ({
    date: futureDates[i] ?? null,
    point: f.point,
    lower: f.lower,
    upper: f.upper,
  }));

  return {
    status: engineResult.status,
    officeId: normOffice,
    serviceId: normService,
    errorCode: null,
    errorMessage: null,
    history: dates.map((d, i) => ({ date: d, count: counts[i] })),
    forecast: forecastPoints,
    weeklyTotal: engineResult.weeklyTotal,
    model: engineResult.model,
    mae: engineResult.mae,
    historyWorkingDays: engineResult.historyWorkingDays,
    historicalTransactionCount: totalTransactions,
    historyStartDate: dates[0],
    historyEndDate: dates.at(-1),
    generatedAt: now.toISOString(),
  };
}

/**
 * Persist the forecast result to the forecast_runs table and return the saved row's id.
 */
export async function saveForecastRun(dataSource, result) {
  const rows = await dataSource.query(
    `INSERT INTO forecast_runs (
       office_id, service_id, selected_model, mae,
       history_start_date, history_end_date, history_working_days, historical_transaction_count,
       forecast_payload, weekly_total, status, error_code, error_message, generated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      result.officeId,
      result.serviceId ?? null,
      result.model,
      result.mae,
      result.historyStartDate,
      result.historyEndDate,
      result.historyWorkingDays,
      result.historicalTransactionCount,
      JSON.stringify(result.forecast),
      result.weeklyTotal,
      result.status,
      result.errorCode ?? null,
      result.errorMessage ?? null,
      result.generatedAt,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Fetch the latest forecast run for a scope, or null if none exists.
 */
export async function getLatestForecastRun(dataSource, officeId, serviceId = null) {
  const rows = await dataSource.query(
    `SELECT * FROM forecast_runs WHERE office_id = $1 AND service_id IS NOT DISTINCT FROM $2
     ORDER BY generated_at DESC, id DESC LIMIT 1`,
    [String(officeId).toLowerCase(), serviceId ? String(serviceId).toLowerCase() : null],
  );
  return rows[0] ?? null;
}

/** True only when a non-error stored forecast run was generated on the current Manila calendar date. */
export function isForecastFreshForToday(row, now = new Date()) {
  if (!row || row.status === 'ERROR' || !row.generated_at) return false;
  try {
    return toManilaDate(row.generated_at) === toManilaDate(now);
  } catch {
    return false;
  }
}

export function formatStoredRun(row, { stale = false } = {}) {
  return {
    calculations: forecastCalculation({ count: row.historical_transaction_count ?? null,
      from: row.history_start_date ? toManilaDate(row.history_start_date) : null,
      to: row.history_end_date ? toManilaDate(row.history_end_date) : null,
      model: row.selected_model, at: row.generated_at, tooFew: row.status === 'TOO_FEW' }),
    status: row.status,
    scope: { officeId: row.office_id, serviceId: row.service_id ?? null },
    stale,
    history: [], // filled by readHistory() on read
    forecast: Array.isArray(row.forecast_payload) ? row.forecast_payload : (row.forecast_payload ?? []),
    weeklyTotal: row.weekly_total ?? 0,
    model: { name: row.selected_model, mae: row.mae != null ? Number(row.mae) : null },
    historyWorkingDays: row.history_working_days ?? 0,
    historicalTransactionCount: row.historical_transaction_count ?? 0,
    historyStartDate: row.history_start_date ?? null,
    historyEndDate: row.history_end_date ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null,
  };
}

export function formatForecastResult(result, { stale = false } = {}) {
  return {
    calculations: forecastCalculation({ count: result.historicalTransactionCount ?? null,
      from: result.historyStartDate ?? null, to: result.historyEndDate ?? null,
      model: result.model, at: result.generatedAt, tooFew: result.status === 'TOO_FEW' }),
    status: result.status,
    scope: { officeId: result.officeId, serviceId: result.serviceId ?? null },
    stale,
    history: result.history,
    forecast: result.forecast,
    weeklyTotal: result.weeklyTotal,
    model: { name: result.model, mae: result.mae },
    historyWorkingDays: result.historyWorkingDays,
    historicalTransactionCount: result.historicalTransactionCount,
    historyStartDate: result.historyStartDate ?? null,
    historyEndDate: result.historyEndDate ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    generatedAt: result.generatedAt,
  };
}

async function readHistorySafe(dataSource, calendarClient, { officeId, serviceId, now }) {
  try {
    const { dates, counts } = await buildHistorySeries(dataSource, calendarClient, {
      officeId,
      serviceId,
      maxWorkingDays: 30,
      now,
    });
    return dates.map((date, i) => ({ date, count: counts[i] }));
  } catch {
    return [];
  }
}

/**
 * Serve today's valid stored forecast (Manila calendar date), or recompute on demand when missing/stale/ERROR.
 * When recomputation fails because Core/calendar is unavailable:
 *  - if an older valid stored run exists, return it explicitly marked stale: true (empty history);
 *  - if no prior valid run exists, throw 503 FORECAST_CALENDAR_UNAVAILABLE rather than inventing data.
 */
export async function readForecast(dataSource, { officeId, serviceId = null, calendarClient = createCalendarClient(), now = new Date() }) {
  const normOffice = String(officeId).toLowerCase();
  const normService = serviceId ? String(serviceId).toLowerCase() : null;
  const stored = await getLatestForecastRun(dataSource, normOffice, normService);

  if (isForecastFreshForToday(stored, now)) {
    const run = formatStoredRun(stored, { stale: false });
    run.history = await readHistorySafe(dataSource, calendarClient, { officeId: normOffice, serviceId: normService, now });
    return run;
  }

  try {
    const result = await computeForecast(dataSource, calendarClient, { officeId: normOffice, serviceId: normService, now });
    await saveForecastRun(dataSource, result);
    return formatForecastResult(result, { stale: false });
  } catch (err) {
    if (stored && stored.status !== 'ERROR') {
      return formatStoredRun(stored, { stale: true });
    }
    if (err instanceof CoreCalendarError) {
      throw Errors.unavailable(
        'The working-time calendar is unavailable and no previous forecast is available',
        'FORECAST_CALENDAR_UNAVAILABLE',
      );
    }
    throw err;
  }
}

export async function retrainForecast(dataSource, { officeId, serviceId = null, calendarClient = createCalendarClient(), now = new Date() }) {
  const normOffice = String(officeId).toLowerCase();
  const normService = serviceId ? String(serviceId).toLowerCase() : null;
  try {
    const result = await computeForecast(dataSource, calendarClient, { officeId: normOffice, serviceId: normService, now });
    await saveForecastRun(dataSource, result);
    return formatForecastResult(result, { stale: false });
  } catch (err) {
    if (err instanceof CoreCalendarError) {
      throw Errors.unavailable('The working-time calendar is unavailable', 'FORECAST_CALENDAR_UNAVAILABLE');
    }
    throw err;
  }
}
