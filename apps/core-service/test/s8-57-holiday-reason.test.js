import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseExceptionInput } from '../src/lib/calendar/exceptions.js';

const base = { exception_date: '2026-12-25', description: 'Christmas Day' };

describe('S8-57 the reason is asked only for a suspension', () => {
  it('a holiday needs no reason and is stored as a holiday proclamation', () => {
    for (const type of ['REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'LOCAL_HOLIDAY']) {
      assert.equal(parseExceptionInput({ ...base, exception_type: type }).reasonCategory, 'HOLIDAY_PROCLAMATION');
    }
  });

  it('a holiday ignores a reason sent with it', () => {
    assert.equal(parseExceptionInput({ ...base, exception_type: 'REGULAR_HOLIDAY', reason_category: 'TYPHOON_WEATHER' }).reasonCategory, 'HOLIDAY_PROCLAMATION');
  });

  it('a suspension still needs a reason from the list', () => {
    assert.throws(() => parseExceptionInput({ ...base, exception_type: 'SUSPENSION' }), (err) => err.details?.reason_category === 'Choose a reason category');
    assert.throws(() => parseExceptionInput({ ...base, exception_type: 'SUSPENSION', reason_category: 'NOPE' }), (err) => err.details?.reason_category === 'Choose a reason from the list');
    assert.equal(parseExceptionInput({ ...base, exception_type: 'SUSPENSION', reason_category: 'TYPHOON_WEATHER' }).reasonCategory, 'TYPHOON_WEATHER');
  });
});
