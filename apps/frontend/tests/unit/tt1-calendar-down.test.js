// TT1 / S8-05 (FE part): when Core or the calendar is down, Operations answers 503 CALENDAR_UNAVAILABLE for Start and Resume
// and writes nothing. The screen must say the calendar is temporarily unavailable and that nothing was started or resumed,
// and must never show a success message for it.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { MESSAGES, startErrorResult } from '../../src/lib/ui/start-transaction.js';
import { HOLD_MESSAGES, holdActionError } from '../../src/lib/ui/hold-transaction.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x') => Object.assign(new Error(message), { name: 'ApiError', status, code, details: null });

describe('Start with the calendar down (AC1, AC4)', () => {
  const result = startErrorResult(apiError(503, 'CALENDAR_UNAVAILABLE', 'Cannot reach the calendar right now. Try again, or record the transaction later as a backdated entry.'));

  it('is its own kind, not the catalogue message', () => {
    assert.equal(result.kind, 'calendar_unavailable');
    assert.notEqual(result.message, MESSAGES.catalogueDown);
  });

  it('says the calendar is temporarily unavailable and that nothing was started or saved', () => {
    assert.match(result.message, /calendar is temporarily unavailable/i);
    assert.match(result.message, /was not started/i);
    assert.match(result.message, /Nothing was saved/i);
    assert.match(result.message, /no tracking number/i);
  });

  it('a catalogue outage keeps its own message', () => {
    assert.equal(startErrorResult(apiError(503, 'CATALOGUE_UNAVAILABLE')).message, MESSAGES.catalogueDown);
  });

  it('the form shows the specific sentence as a notification and a banner, and only says "created" after the server answered', () => {
    const form = read('src/components/transactions/StartTransactionForm.js');
    assert.match(form, /notify\.error\(kind === 'calendar_unavailable' \? message : saveFailureMessage\(err, message\)\)/);
    assert.match(form, /kind === 'calendar_unavailable'\) \? \{ kind, message, conflict \}/);
    const catchBlock = form.slice(form.indexOf('} catch (err) {\r\n      if (err?.status === 409 && err.code === \'OUTSIDE_WORKING_TIME\''), form.indexOf('submittingRef.current = false;'));
    assert.ok(catchBlock.length > 100, 'found the catch block');
    assert.doesNotMatch(catchBlock, /notify\.success/, 'no success message on a failed start');
  });
});

describe('Resume with the calendar down (AC2, AC4)', () => {
  const failure = holdActionError(apiError(503, 'CALENDAR_UNAVAILABLE'), 'resume');

  it('says the calendar cannot be reached and that the transaction is still pending', () => {
    assert.equal(failure.kind, 'calendar_unavailable');
    assert.equal(failure.message, HOLD_MESSAGES.calendarDown);
    assert.match(failure.message, /calendar cannot be reached/i);
    assert.match(failure.message, /could not be resumed/i);
    assert.match(failure.message, /still pending/i);
    assert.match(failure.message, /try again/i);
  });

  it('an unmapped 502/503/504 on resume gives the same calendar message', () => {
    for (const status of [502, 503, 504]) assert.equal(holdActionError(apiError(status, 'UPSTREAM'), 'resume').message, HOLD_MESSAGES.calendarDown);
  });

  it('the failed resume reports an error and never a success', () => {
    const detail = read('src/components/transactions/TransactionDetail.js');
    const start = detail.indexOf('async function confirmResume()');
    const body = detail.slice(start, detail.indexOf('async function', start + 10) > 0 ? detail.indexOf('function openCompleteDialog', start) : undefined);
    const catchPart = body.slice(body.indexOf('} catch (err) {'));
    assert.match(catchPart, /variant: 'error'/);
    assert.doesNotMatch(catchPart, /variant: 'success'|notify\.success/);
  });
});
