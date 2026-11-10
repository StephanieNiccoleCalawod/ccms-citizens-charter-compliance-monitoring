/**
 * Holt-Winters Additive model with seasonal period m=5 (working days per week).
 * Fixed parameters: α=0.3 (level), β=0.1 (trend), γ=0.3 (seasonal).
 * Deterministic: same data always produces the same result.
 *
 * Requires at least 2*m = 10 observations.
 *
 * Initialization:
 *   avg1   = mean(y[0..m-1])
 *   avg2   = mean(y[m..2m-1])
 *   l₀     = avg1                       (level at t=m-1, pre-loop)
 *   b₀     = (avg2 - avg1) / m          (trend at t=m-1)
 *   s[i]   = y[i] - avg1  for i=0..m-1  (initial seasonal factors)
 *
 * Recurrence for t = m .. n-1:
 *   l[t] = α*(y[t] - s[t-m]) + (1-α)*(l[t-1] + b[t-1])
 *   b[t] = β*(l[t] - l[t-1]) + (1-β)*b[t-1]
 *   s[t] = γ*(y[t] - l[t])   + (1-γ)*s[t-m]
 *
 * Forecast h steps ahead (h=1..horizon):
 *   ŷ(h) = l[n-1] + h*b[n-1] + s[n - m + ((h-1) % m)]
 */

export const HW_ALPHA = 0.3;
export const HW_BETA  = 0.1;
export const HW_GAMMA = 0.3;
export const SEASON   = 5;

export class NotEnoughDataError extends Error {
  constructor(msg) { super(msg); this.name = 'NotEnoughDataError'; }
}

/**
 * Fit Holt-Winters on `data` and return forecasts for the next `horizon` working days.
 * @param {number[]} data    non-negative integer counts, chronological
 * @param {number}   horizon steps to forecast (default = SEASON = 5)
 */
export function fitHoltWinters(data, horizon = SEASON) {
  if (!Array.isArray(data) || data.length < 2 * SEASON) {
    throw new NotEnoughDataError(`Holt-Winters needs at least ${2 * SEASON} observations, got ${data?.length ?? 0}`);
  }

  const n = data.length;
  const m = SEASON;

  // --- Initialization ---
  let avg1 = 0, avg2 = 0;
  for (let i = 0; i < m; i++) avg1 += data[i];
  for (let i = m; i < 2 * m; i++) avg2 += data[i];
  avg1 /= m;
  avg2 /= m;

  // s is extended to cover negative-index-free access: s[t-m] where t starts at m means s[0] is first used
  // We store n+m values so that s[t] covers t=0..n-1 without offset.
  const s = new Array(n);
  for (let i = 0; i < m; i++) s[i] = data[i] - avg1;

  let lPrev = avg1;
  let bPrev = (avg2 - avg1) / m;
  let lCurr = lPrev;
  let bCurr = bPrev;

  // --- Recurrence from t=m ---
  for (let t = m; t < n; t++) {
    const y = data[t];
    lCurr = HW_ALPHA * (y - s[t - m]) + (1 - HW_ALPHA) * (lPrev + bPrev);
    bCurr = HW_BETA  * (lCurr - lPrev) + (1 - HW_BETA) * bPrev;
    s[t]  = HW_GAMMA * (y - lCurr)     + (1 - HW_GAMMA) * s[t - m];
    lPrev = lCurr;
    bPrev = bCurr;
  }

  // The last m seasonal factors (s[n-m..n-1]) for cyclic forecast
  // Forecast h=1..horizon: ŷ(h) = lCurr + h*bCurr + s[n-m + ((h-1) % m)]
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const point = lCurr + h * bCurr + s[n - m + ((h - 1) % m)];
    return Math.max(0, Math.round(point));
  });

  return { forecast, level: lCurr, trend: bCurr };
}

/**
 * Back-test: train on data[0..n-testLength-1], return testLength predictions.
 * Used by the model selection step.
 */
export function backTestHoltWinters(data, testLength = SEASON) {
  const train = data.slice(0, data.length - testLength);
  const { forecast } = fitHoltWinters(train, testLength);
  return forecast;
}
