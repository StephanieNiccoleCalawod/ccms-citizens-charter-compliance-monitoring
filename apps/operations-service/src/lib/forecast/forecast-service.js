/**
 * Orchestrates one complete forecast run for a given scope (office or office+service).
 * Calls the aggregator, the calendar client, and the engine; persists the result to forecast_runs.
 *
 * Returns a ForecastResult object whose shape is what the API route renders.
 */

import { buildHistorySeries, countServiceTransactions } from './aggregator.js';
import { MIN_HISTORY, MIN_SERVICE_TXN, runForecastEngine } from './engine.js';

/**
 * @param {import('typeorm').DataSource}  dataSource
 * @param {object}  calendarClient   createCalendarClient() instance
 * @param {{
 *   officeId: string,
 *   serviceId?: string|null,
 *   maxWorkingDays?: number,
 * }} opts
 * @returns {Promise<ForecastResult>}
 */
export async function computeForecast(dataSource, calendarClient, { officeId, serviceId = null, maxWorkingDays = 30 }) {
  const now = new Date();

  // Service-level guard: too few total transactions means we can't forecast at service level
  if (serviceId) {
    const total = await countServiceTransactions(dataSource, officeId, serviceId);
    if (total < MIN_SERVICE_TXN) {
      return {
        status: 'TOO_FEW',
        officeId,
        serviceId,
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
    officeId,
    serviceId,
    maxWorkingDays,
  });

  if (dates.length < MIN_HISTORY) {
    return {
      status: 'NOT_ENOUGH_HISTORY',
      officeId,
      serviceId,
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
  const futureDates = await calendarClient.nextWorkingDays(lastHistoryDate, 5, officeId);

  // Combine forecast points with dates
  const forecastPoints = engineResult.forecast.map((f, i) => ({
    date: futureDates[i] ?? null,
    point: f.point,
    lower: f.lower,
    upper: f.upper,
  }));

  return {
    status: engineResult.status,
    officeId,
    serviceId,
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
     ORDER BY generated_at DESC LIMIT 1`,
    [officeId, serviceId ?? null],
  );
  return rows[0] ?? null;
}
