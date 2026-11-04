import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { elapsedState, formatElapsed, parseInstant } from '../../src/lib/ui/elapsed-time.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const START = '2026-10-30T08:25:00.000Z'; // 4:25 PM in Manila
const at = (offsetSeconds) => Date.parse(START) + offsetSeconds * 1000;

describe('formatElapsed', () => {
  it('under an hour: minutes and seconds', () => {
    assert.equal(formatElapsed((25 * 60 + 34) * 1000), '25 minutes 34 seconds');
    assert.equal(formatElapsed(34 * 1000), '34 seconds');
    assert.equal(formatElapsed(61 * 1000), '1 minute 1 second');
  });
  it('an hour or more: hours, minutes and seconds', () => {
    assert.equal(formatElapsed((2 * 3600 + 15 * 60 + 34) * 1000), '2 hours 15 minutes 34 seconds');
    assert.equal(formatElapsed(3600 * 1000), '1 hour');
  });
  it('a day or more drops the seconds', () => {
    assert.equal(formatElapsed((86400 + 3 * 3600 + 15 * 60 + 40) * 1000), '1 day 3 hours 15 minutes');
    assert.equal(formatElapsed(2 * 86400 * 1000), '2 days');
  });
  it('zero, negative and junk read as 0 seconds', () => {
    assert.equal(formatElapsed(0), '0 seconds');
    assert.equal(formatElapsed(-5000), '0 seconds');
    assert.equal(formatElapsed(undefined), '0 seconds');
  });
  it('rounds down to whole seconds', () => {
    assert.equal(formatElapsed(1999), '1 second');
  });
});

describe('parseInstant', () => {
  it('reads API timestamps and refuses missing or invalid ones', () => {
    assert.equal(parseInstant(START), Date.parse(START));
    assert.equal(parseInstant('2026-10-30T16:25:00+08:00'), Date.parse(START)); // Manila offset = same instant
    for (const bad of [null, undefined, '', '   ', 'not a date', 5]) assert.equal(parseInstant(bad), null);
  });
});

describe('elapsedState', () => {
  const tx = (over) => ({ status: 'IN_PROGRESS', started_at: START, ended_at: null, hold_started_at: null, ...over });
  it('in progress counts from started_at to now, so any page or tab agrees', () => {
    assert.deepEqual(elapsedState(tx({}), at(90)), { kind: 'live', ms: 90000 });
    assert.deepEqual(elapsedState(tx({}), at(150)), { kind: 'live', ms: 150000 });
  });
  it('a clock slightly behind the server never shows a negative time', () => {
    assert.deepEqual(elapsedState(tx({}), at(-3)), { kind: 'live', ms: 0 });
  });
  it('pending (ON_HOLD) stops at the moment it was held and does not grow', () => {
    const held = tx({ status: 'ON_HOLD', hold_started_at: new Date(at(600)).toISOString() });
    assert.deepEqual(elapsedState(held, at(700)), { kind: 'paused', ms: 600000 });
    assert.deepEqual(elapsedState(held, at(99999)), { kind: 'paused', ms: 600000 });
  });
  it('completed is fixed from started_at to ended_at', () => {
    const done = tx({ status: 'COMPLETED', ended_at: new Date(at(1800)).toISOString() });
    assert.deepEqual(elapsedState(done, at(5)), { kind: 'final', ms: 1800000 });
    assert.deepEqual(elapsedState(done, at(99999)), { kind: 'final', ms: 1800000 });
  });
  it('cancelled has no recorded end time, so nothing is counted or invented', () => {
    assert.deepEqual(elapsedState(tx({ status: 'CANCELLED' }), at(100)), { kind: 'unavailable' });
  });
  it('missing or invalid timestamps are unavailable, not a crash', () => {
    assert.deepEqual(elapsedState(tx({ started_at: null }), at(1)), { kind: 'unavailable' });
    assert.deepEqual(elapsedState(tx({ started_at: 'junk' }), at(1)), { kind: 'unavailable' });
    assert.deepEqual(elapsedState(tx({ status: 'ON_HOLD' }), at(1)), { kind: 'unavailable' });
    assert.deepEqual(elapsedState(tx({ status: 'COMPLETED' }), at(1)), { kind: 'unavailable' });
    assert.deepEqual(elapsedState(null, at(1)), { kind: 'unavailable' });
  });
});

describe('the timer component (source checks, not a browser)', () => {
  const source = read('src/components/ui/ElapsedTime.js');
  it('ticks only while in progress, with one interval that is cleared on cleanup', () => {
    assert.equal([...source.matchAll(/setInterval\(/g)].length, 1);
    assert.match(source, /if \(!live\) return undefined;/);
    assert.match(source, /return \(\) => clearInterval\(timer\)/);
    assert.match(source, /\}, \[live\]\);/);
  });
  it('uses the transaction\'s own started_at, never a start time taken when the page opened', () => {
    assert.match(source, /elapsedState\(transaction, now\)/);
    // the only start value used in code is transaction.started_at (the other mention is a comment)
    assert.match(source, /Date\.parse\(transaction\.started_at/);
    assert.doesNotMatch(source, /started\s*=|startedAt|new Date\(\)\.getTime\(\)\s*-/);
  });
  it('the detail page uses it and still shows the hold time from the API\'s held_minutes', () => {
    const page = (read('src/app/transactions/[id]/page.js') + read('src/components/transactions/TransactionDetail.js'));
    assert.match(page, /<ElapsedTime transaction=\{tx\} \/>/);
    assert.match(page, /formatHeldMinutes\(tx\.held_minutes\)/);
  });
});
