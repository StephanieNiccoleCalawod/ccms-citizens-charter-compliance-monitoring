import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseExceptionInput, toEngineEntry } from '../src/lib/calendar/exceptions.js';
import { buildMessage, CHANGE_KIND } from '../src/lib/calendar/message.js';

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

  it('the stored holiday reason leaves the cal-1.0 payload unchanged', () => {
    const input = parseExceptionInput({ ...base, exception_type: 'REGULAR_HOLIDAY' });
    const row = { ...input, exceptionId: '8b4e405e-a6ee-4fe1-9589-13963c12670a', revision: 1 };
    const sample = (reasonCategory) => buildMessage({
      messageId: 'b8c5dca0-7291-4d4d-b483-06073077d511',
      entry: toEngineEntry({ ...row, reasonCategory }),
      date: input.exceptionDate,
      changeKind: CHANGE_KIND.UPSERT,
    });
    const payload = sample(input.reasonCategory);
    assert.equal(payload.schemaVersion, 'cal-1.0');
    assert.equal(payload.entryType, 'REGULAR_HOLIDAY');
    assert.deepEqual(payload, sample('OTHER'));
  });

  it('a suspension still needs a reason from the list', () => {
    assert.throws(() => parseExceptionInput({ ...base, exception_type: 'SUSPENSION' }), (err) => err.details?.reason_category === 'Choose a reason category');
    assert.throws(() => parseExceptionInput({ ...base, exception_type: 'SUSPENSION', reason_category: 'NOPE' }), (err) => err.details?.reason_category === 'Choose a reason from the list');
    assert.equal(parseExceptionInput({ ...base, exception_type: 'SUSPENSION', reason_category: 'TYPHOON_WEATHER' }).reasonCategory, 'TYPHOON_WEATHER');
  });

  it('requires a reason when converting a holiday and retains an existing suspension reason on edit', () => {
    const suspension = { ...base, exception_type: 'SUSPENSION' };
    const previousHoliday = { exception_type: 'REGULAR_HOLIDAY', reason_category: 'HOLIDAY_PROCLAMATION' };
    assert.throws(() => parseExceptionInput(suspension, { previous: previousHoliday }), (err) =>
      err.details?.reason_category === 'Choose a reason category');
    assert.equal(parseExceptionInput({ ...suspension, reason_category: 'TYPHOON_WEATHER' }, { previous: previousHoliday }).reasonCategory, 'TYPHOON_WEATHER');

    const previousSuspension = { exception_type: 'SUSPENSION', reason_category: 'HEAT_INDEX' };
    assert.equal(parseExceptionInput(suspension, { previous: previousSuspension }).reasonCategory, 'HEAT_INDEX');
  });
});
