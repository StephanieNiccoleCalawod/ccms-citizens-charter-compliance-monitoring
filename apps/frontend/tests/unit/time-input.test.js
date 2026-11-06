import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { END_AFTER_START_MESSAGE, END_REQUIRED_MESSAGE, INVALID_TIME_MESSAGE, START_REQUIRED_MESSAGE, suspensionTimes, timeInputValue, timeToApi, unmatchedErrorMessages } from '../../src/lib/ui/time-input.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('time input values (HH:mm, 24-hour)', () => {
  it('the 12-hour examples arrive from the input as the API format and pass through unchanged', () => {
    // a native time input reports 1:00 PM as 13:00, 9:30 AM as 09:30, 12:00 AM as 00:00 and 12:00 PM as 12:00
    for (const value of ['13:00', '09:30', '00:00', '12:00', '23:59']) assert.deepEqual(timeToApi(value), { value, error: null });
  });
  it('empty means the whole day (null), not an error', () => {
    assert.deepEqual(timeToApi(''), { value: null, error: null });
    assert.deepEqual(timeToApi('  '), { value: null, error: null });
    assert.deepEqual(timeToApi(undefined), { value: null, error: null });
  });
  it('an impossible time is refused with a clear message, so 01:60 is never sent', () => {
    for (const bad of ['01:60', '24:00', '9:30', '13:0', 'abc', '13:00:00']) assert.deepEqual(timeToApi(bad), { value: null, error: INVALID_TIME_MESSAGE });
    assert.equal(INVALID_TIME_MESSAGE, 'Enter a valid time.');
  });
  it('a saved time (with or without seconds) fills the input as HH:mm; unreadable gives empty', () => {
    assert.equal(timeInputValue('13:00'), '13:00');
    assert.equal(timeInputValue('13:00:00'), '13:00');
    assert.equal(timeInputValue(null), '');
    assert.equal(timeInputValue('01:60'), '');
  });
});

describe('the Suspended from field (source checks, not a browser)', () => {
  const page = read('src/app/calendar/Holidays.js');
  it('is a native time input, optional, with no "24-hour HH:MM" wording or manual-entry attributes', () => {
    const at = page.indexOf('id="suspended_from"');
    const field = page.slice(at - 200, at + 500);
    assert.ok(field.includes('type="time"'));
    assert.ok(!field.includes('maxLength') && !field.includes('placeholder="HH:MM"') && !field.includes('inputMode'));
    assert.ok(!page.includes('24-hour'));
    assert.ok(page.includes('Leave both empty for a whole-day suspension.'));
  });
  it('is converted with timeToApi before it is sent, and a bad value stops the request with the field message', () => {
    assert.ok(page.includes('const time = suspensionTimes(form.suspended_from, form.suspended_until)'));
    assert.ok(page.includes('suspended_from: time.from') && page.includes('suspended_until: time.until'));
    assert.ok(page.includes('...time.errors'), 'a bad time stops the request and shows under its field');
  });
});

describe('Suspended from and Suspended until together', () => {
  it('both empty is a whole-day suspension, with no error and both null', () => {
    assert.deepEqual(suspensionTimes('', ''), { from: null, until: null, errors: {} });
  });
  it('both given and the end later: both are sent as HH:mm', () => {
    assert.deepEqual(suspensionTimes('09:30', '13:00'), { from: '09:30', until: '13:00', errors: {} });
    assert.deepEqual(suspensionTimes('00:00', '12:00').errors, {});
  });
  it('the end must be later than the start (equal is not later)', () => {
    assert.deepEqual(suspensionTimes('13:00', '09:30').errors, { suspended_until: END_AFTER_START_MESSAGE });
    assert.deepEqual(suspensionTimes('13:00', '13:00').errors, { suspended_until: END_AFTER_START_MESSAGE });
  });
  it('a part-day suspension needs both times', () => {
    assert.deepEqual(suspensionTimes('13:00', '').errors, { suspended_until: END_REQUIRED_MESSAGE });
    assert.deepEqual(suspensionTimes('', '15:00').errors, { suspended_from: START_REQUIRED_MESSAGE });
  });
  it('an impossible time is the field message, and no order message on top of it', () => {
    assert.deepEqual(suspensionTimes('01:60', '15:00').errors, { suspended_from: INVALID_TIME_MESSAGE });
    assert.deepEqual(suspensionTimes('09:00', '25:00').errors, { suspended_until: INVALID_TIME_MESSAGE });
  });
});

describe('errors for fields with no input go to the form banner', () => {
  it('keeps the messages of fields that are not shown, and none of the shown ones', () => {
    const shown = ['suspended_from', 'suspended_until'];
    assert.deepEqual(unmatchedErrorMessages({ suspended_until: 'End is wrong', reason: 'A reason is needed', note: ' x ' }, shown), ['A reason is needed', 'x']);
    assert.deepEqual(unmatchedErrorMessages({ suspended_from: 'a' }, shown), []);
    assert.deepEqual(unmatchedErrorMessages(null, shown), []);
    assert.deepEqual(unmatchedErrorMessages({ other: 5, blank: '  ' }, shown), []);
  });
});

describe('the Suspended until field (source checks, not a browser)', () => {
  const page = read('src/app/calendar/Holidays.js');
  it('is a native time input next to Suspended from, with its own error under it', () => {
    const at = page.indexOf('id="suspended_until"');
    assert.ok(page.slice(at, at + 200).includes('type="time"'));
    assert.ok(page.includes('Suspended until') && page.includes('{fieldErrors.suspended_until ?'));
    assert.ok(page.indexOf('id="suspended_from"') < at);
  });
  it('shows the saved end time with the start, loads it for editing, and shows unmatched errors in a form banner', () => {
    assert.ok(page.includes('Suspended until: {formatTime(entry.suspended_until)'));
    assert.ok(page.includes('suspended_until: timeInputValue(entry.suspended_until)'));
    assert.ok(page.includes('<ErrorBanner message={formLevelErrors.join'));
    assert.ok(page.includes('unmatchedErrorMessages(fieldErrors, shownFields)'));
  });
});
