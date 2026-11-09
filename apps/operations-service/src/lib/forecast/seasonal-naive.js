/**
 * Seasonal Naive model: each forecast repeats the value from exactly one seasonal period ago.
 * Seasonal period m=5 (working days per week).
 *
 * ŷ(h) = y[n - m + ((h-1) % m)]   for h = 1..horizon
 *
 * Requires at least m=5 observations (one full cycle).
 */

export const SEASON = 5;

export class NotEnoughDataError extends Error {
  constructor(msg) { super(msg); this.name = 'NotEnoughDataError'; }
}

/**
 * @param {number[]} data    chronological working-day counts
 * @param {number}   horizon steps to forecast (default 5)
 */
export function fitSeasonalNaive(data, horizon = SEASON) {
  if (!Array.isArray(data) || data.length < SEASON) {
    throw new NotEnoughDataError(`Seasonal Naive needs at least ${SEASON} observations, got ${data?.length ?? 0}`);
  }
  const n = data.length;
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const srcIdx = n - SEASON + ((h - 1) % SEASON);
    return Math.max(0, Math.round(data[srcIdx]));
  });
  return { forecast };
}

/** Back-test: train on data[0..n-testLength-1], return testLength predictions. */
export function backTestSeasonalNaive(data, testLength = SEASON) {
  const train = data.slice(0, data.length - testLength);
  const { forecast } = fitSeasonalNaive(train, testLength);
  return forecast;
}
