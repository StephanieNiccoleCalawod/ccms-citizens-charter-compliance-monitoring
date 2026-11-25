import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLAG_LOW_RATING, satisfaction } from '../src/modules/ratings/ratings.js';

test('flag 5: low service rating needs 10 ratings and an average below 3.0', () => {
  assert.deepEqual(satisfaction({ count: 10, average: 2.99, asked: 20 }).flags, [FLAG_LOW_RATING]);
  assert.deepEqual(satisfaction({ count: 10, average: 3, asked: 20 }).flags, []);
  assert.deepEqual(satisfaction({ count: 9, average: 1, asked: 20 }).flags, []);
});
test('below 10 ratings the answer is "not enough ratings yet"; response rate is ratings over codes handed out', () => {
  assert.equal(satisfaction({ count: 9, average: 4, asked: 12 }).enough_ratings, false);
  assert.equal(satisfaction({ count: 10, average: 4, asked: 40 }).response_rate, 25);
  assert.equal(satisfaction({ count: 0, average: null, asked: 0 }).response_rate, null);
});
