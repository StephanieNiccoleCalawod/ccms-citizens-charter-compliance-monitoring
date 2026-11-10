/**
 * Forecast engine for CC038: model selection, back-test MAE, forecast generation, and range calculation.
 *
 * Back-test protocol (5-day hold-out):
 *   - Hold out the last BACK_TEST days as the test set.
 *   - Train both models on data[0..n-BACK_TEST-1].
 *   - Each model forecasts BACK_TEST steps ahead.
 *   - MAE = mean(|actual[i] - predicted[i]|) for i in the test set.
 *   - Select the model with the lower MAE.
 *   - Tie-breaker: Holt-Winters is preferred (it is Model A).
 *   - Refit the winning model on ALL data to generate the production forecast.
 *
 * Forecast range (10th–90th percentile of back-test residuals):
 *   residuals[i] = actual[i] - predicted[i]   (positive = under-estimated)
 *   lower_bound = point_forecast + percentile(residuals, 0.10)
 *   upper_bound = point_forecast + percentile(residuals, 0.90)
 *   Both are then clamped: lower >= 0, upper >= point_forecast.
 *   The same quantile pair is applied to every forecast point.
 */

import { SEASON, backTestHoltWinters, fitHoltWinters } from './holt-winters.js';
import { backTestSeasonalNaive, fitSeasonalNaive } from './seasonal-naive.js';

export const BACK_TEST = SEASON; // 5-day back-test horizon
export const MIN_HISTORY = 20;   // working days required for an office-level forecast
export const MIN_SERVICE_TXN = 40; // total transactions required for a service forecast

export const MODEL_HW = 'HOLT_WINTERS_ADDITIVE';
export const MODEL_SN = 'SEASONAL_NAIVE';

/** Mean Absolute Error between two equal-length arrays. */
export function mae(actual, predicted) {
  if (actual.length !== predicted.length || actual.length === 0) return Infinity;
  return actual.reduce((sum, a, i) => sum + Math.abs(a - predicted[i]), 0) / actual.length;
}

/**
 * Linear-interpolated percentile on a sorted array.
 * Uses the C=1 convention: p ∈ [0,1], index = p*(n-1).
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Run the full forecast pipeline on a working-day count series.
 *
 * @param {number[]} counts - chronological working-day transaction counts (zeros included)
 * @returns {{
 *   status: 'SUCCESS'|'NOT_ENOUGH_HISTORY',
 *   model: string,
 *   mae: number|null,
 *   forecast: Array<{point:number,lower:number,upper:number}>,
 *   weeklyTotal: number,
 *   historyWorkingDays: number,
 * }}
 */
export function runForecastEngine(counts) {
  const n = counts.length;

  if (n < MIN_HISTORY) {
    return {
      status: 'NOT_ENOUGH_HISTORY',
      model: 'NONE',
      mae: null,
      forecast: [],
      weeklyTotal: 0,
      historyWorkingDays: n,
    };
  }

  const testActual = counts.slice(n - BACK_TEST);

  // --- Back-test both models ---
  let hwPred = null, snPred = null, hwMae = Infinity, snMae = Infinity;

  try {
    hwPred = backTestHoltWinters(counts, BACK_TEST);
    hwMae  = mae(testActual, hwPred);
  } catch { /* not enough data for HW; will fall back to SN */ }

  try {
    snPred = backTestSeasonalNaive(counts, BACK_TEST);
    snMae  = mae(testActual, snPred);
  } catch { /* should never happen with >= MIN_HISTORY */ }

  // --- Model selection (tie-breaker: prefer HW) ---
  const useHw = hwPred !== null && hwMae <= snMae;
  const selectedModel = useHw ? MODEL_HW : MODEL_SN;
  const selectedMae   = useHw ? hwMae : snMae;
  const backTestPred  = useHw ? hwPred : snPred;

  // --- Residuals for range calculation ---
  const residuals = testActual.map((a, i) => a - backTestPred[i]).sort((a, b) => a - b);
  const qLow  = percentile(residuals, 0.10);
  const qHigh = percentile(residuals, 0.90);

  // --- Refit on all data ---
  let pointForecasts;
  try {
    if (useHw) {
      ({ forecast: pointForecasts } = fitHoltWinters(counts, BACK_TEST));
    } else {
      ({ forecast: pointForecasts } = fitSeasonalNaive(counts, BACK_TEST));
    }
  } catch {
    return {
      status: 'NOT_ENOUGH_HISTORY',
      model: 'NONE',
      mae: null,
      forecast: [],
      weeklyTotal: 0,
      historyWorkingDays: n,
    };
  }

  const forecast = pointForecasts.map((point) => ({
    point,
    lower: Math.max(0, Math.round(point + qLow)),
    upper: Math.max(point, Math.round(point + qHigh)),
  }));

  const weeklyTotal = forecast.reduce((sum, f) => sum + f.point, 0);

  return {
    status: 'SUCCESS',
    model: selectedModel,
    mae: Math.round(selectedMae * 10000) / 10000,
    forecast,
    weeklyTotal,
    historyWorkingDays: n,
  };
}
