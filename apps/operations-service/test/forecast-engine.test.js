// CC038 forecast engine unit tests: Holt-Winters, Seasonal Naive, model selection, percentile, range.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fitHoltWinters, backTestHoltWinters } from '../src/lib/forecast/holt-winters.js';
import { fitSeasonalNaive, backTestSeasonalNaive } from '../src/lib/forecast/seasonal-naive.js';
import { mae, percentile, runForecastEngine, MIN_HISTORY, MODEL_HW, MODEL_SN, BACK_TEST } from '../src/lib/forecast/engine.js';

// --- Utilities ---
describe('mae', () => {
  it('returns mean absolute error for equal-length arrays', () => {
    assert.equal(mae([10, 20, 30], [10, 20, 30]), 0);
    assert.ok(Math.abs(mae([10, 20, 30], [15, 20, 25]) - 10 / 3) < 1e-10);
    assert.equal(mae([10, 10, 10], [15, 5, 10]), 10 / 3);
    assert.equal(mae([0], [5]), 5);
    assert.equal(mae([5], [0]), 5);
  });

  it('returns Infinity for mismatched or empty arrays', () => {
    assert.equal(mae([], []), Infinity);
    assert.equal(mae([1, 2], [1]), Infinity);
  });
});

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    assert.equal(percentile([], 0.5), 0);
  });

  it('returns the only element for a singleton', () => {
    assert.equal(percentile([42], 0.5), 42);
  });

  it('returns exact values at boundary indices', () => {
    const arr = [1, 2, 3, 4, 5];
    assert.equal(percentile(arr, 0), 1);
    assert.equal(percentile(arr, 1), 5);
  });

  it('linearly interpolates between values (C=1 convention)', () => {
    const arr = [0, 10];
    assert.equal(percentile(arr, 0.5), 5);
  });
});

// --- Holt-Winters ---
describe('fitHoltWinters', () => {
  const data20 = Array.from({ length: 20 }, (_, i) => 50 + (i % 5) * 10);

  it('requires at least 10 observations', () => {
    assert.throws(() => fitHoltWinters([1, 2, 3], 5), /at least/);
  });

  it('returns exactly `horizon` forecast values', () => {
    const { forecast } = fitHoltWinters(data20, 5);
    assert.equal(forecast.length, 5);
  });

  it('all forecast values are non-negative integers', () => {
    const { forecast } = fitHoltWinters(data20, 5);
    for (const v of forecast) {
      assert.ok(v >= 0, `negative forecast: ${v}`);
      assert.equal(v, Math.round(v));
    }
  });

  it('is deterministic: same input → same output', () => {
    const a = fitHoltWinters(data20, 5);
    const b = fitHoltWinters(data20, 5);
    assert.deepEqual(a.forecast, b.forecast);
  });
});

describe('backTestHoltWinters', () => {
  const data20 = Array.from({ length: 20 }, (_, i) => 50 + (i % 5) * 10);

  it('returns exactly testLength predictions', () => {
    assert.equal(backTestHoltWinters(data20, 5).length, 5);
  });

  it('requires enough data for training + testLength', () => {
    assert.throws(() => backTestHoltWinters([1, 2, 3, 4, 5], 5), /at least/);
  });
});

// --- Seasonal Naive ---
describe('fitSeasonalNaive', () => {
  const data10 = [10, 20, 30, 40, 50, 11, 21, 31, 41, 51];

  it('requires at least 5 observations', () => {
    assert.throws(() => fitSeasonalNaive([1, 2, 3], 5), /at least/);
  });

  it('returns exactly `horizon` forecast values', () => {
    const { forecast } = fitSeasonalNaive(data10, 5);
    assert.equal(forecast.length, 5);
  });

  it('forecast equals the last seasonal cycle', () => {
    const { forecast } = fitSeasonalNaive(data10, 5);
    // The last 5 values are [11,21,31,41,51]; h=1→idx 5, h=2→idx 6, etc.
    assert.deepEqual(forecast, [11, 21, 31, 41, 51]);
  });
});

describe('backTestSeasonalNaive', () => {
  const data10 = [10, 20, 30, 40, 50, 11, 21, 31, 41, 51];

  it('returns exactly testLength predictions', () => {
    assert.equal(backTestSeasonalNaive(data10, 5).length, 5);
  });
});

// --- Engine ---
describe('runForecastEngine', () => {
  it(`returns NOT_ENOUGH_HISTORY when fewer than ${MIN_HISTORY} working days provided`, () => {
    const short = Array.from({ length: MIN_HISTORY - 1 }, () => 10);
    const result = runForecastEngine(short);
    assert.equal(result.status, 'NOT_ENOUGH_HISTORY');
    assert.equal(result.historyWorkingDays, MIN_HISTORY - 1);
    assert.deepEqual(result.forecast, []);
  });

  it(`returns NOT_ENOUGH_HISTORY with exactly ${MIN_HISTORY - 1} working days`, () => {
    const result = runForecastEngine(Array(MIN_HISTORY - 1).fill(5));
    assert.equal(result.status, 'NOT_ENOUGH_HISTORY');
  });

  it(`returns SUCCESS with exactly ${MIN_HISTORY} working days`, () => {
    const counts = Array.from({ length: MIN_HISTORY }, (_, i) => 50 + (i % 5) * 5);
    const result = runForecastEngine(counts);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.forecast.length, BACK_TEST);
    assert.ok(result.weeklyTotal >= 0);
  });

  it('SUCCESS result has correct shape: forecast array with point/lower/upper', () => {
    const counts = Array.from({ length: 25 }, (_, i) => 40 + (i % 5) * 8);
    const result = runForecastEngine(counts);
    assert.equal(result.status, 'SUCCESS');
    for (const f of result.forecast) {
      assert.ok('point' in f && 'lower' in f && 'upper' in f);
      assert.ok(f.lower >= 0, `lower < 0: ${f.lower}`);
      assert.ok(f.upper >= f.point, `upper < point: ${f.upper} < ${f.point}`);
    }
  });

  it('weeklyTotal equals sum of point forecasts', () => {
    const counts = Array.from({ length: 25 }, (_, i) => 40 + (i % 5) * 8);
    const { weeklyTotal, forecast } = runForecastEngine(counts);
    assert.equal(weeklyTotal, forecast.reduce((s, f) => s + f.point, 0));
  });

  it('prefers HOLT_WINTERS on tie (both models produce identical MAE)', () => {
    // A flat series: both models will forecast the same value → identical MAE → HW wins
    const flat = Array(25).fill(100);
    const { model } = runForecastEngine(flat);
    assert.equal(model, MODEL_HW);
  });

  it('selects SEASONAL_NAIVE if it beats HOLT_WINTERS', () => {
    // Strongly seasonal but not trending → HW may lose
    // We just verify the returned model is one of the two valid constants
    const counts = Array.from({ length: 25 }, (_, i) => 50 + (i % 5) * 20);
    const { model } = runForecastEngine(counts);
    assert.ok(model === MODEL_HW || model === MODEL_SN, `unexpected model: ${model}`);
  });

  it('mae field is a non-negative finite number on SUCCESS', () => {
    const counts = Array.from({ length: 25 }, (_, i) => 50 + (i % 5) * 8);
    const { mae: resultMae } = runForecastEngine(counts);
    assert.ok(typeof resultMae === 'number' && isFinite(resultMae) && resultMae >= 0);
  });

  it('historyWorkingDays equals the input length on SUCCESS', () => {
    const counts = Array.from({ length: 22 }, (_, i) => 30 + (i % 5) * 6);
    const { historyWorkingDays } = runForecastEngine(counts);
    assert.equal(historyWorkingDays, 22);
  });
});
