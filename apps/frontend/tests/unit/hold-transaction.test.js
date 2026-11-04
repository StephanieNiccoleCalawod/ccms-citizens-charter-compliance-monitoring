import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { TRANSACTIONS_API, getTransaction, holdTransaction, resumeTransaction } from '../../src/lib/api/transactions.js';
import { HOLD_MESSAGES, HOLD_REASON_MAX, canHold, canResume, formatHeldMinutes, holdActionError, loadErrorResult, validateHoldReason } from '../../src/lib/ui/hold-transaction.js';

// MOCKED fetchers and error objects shaped like the real contract (Operations hold.js, list.js, settings.js).
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const ID = '33333333-3333-4333-8333-333333333333';

describe('hold and resume requests', () => {
  it('reads one transaction, holds with only the reason, resumes with no body', async () => {
    const calls = [];
    const fetcher = async (url, options) => { calls.push({ url, options }); return {}; };
    await getTransaction(ID, fetcher);
    await holdTransaction(ID, 'Waiting for a signature', fetcher);
    await resumeTransaction(ID, fetcher);
    assert.deepEqual(calls, [
      { url: `${TRANSACTIONS_API}/${ID}`, options: undefined },
      { url: `${TRANSACTIONS_API}/${ID}/hold`, options: { method: 'POST', body: { reason: 'Waiting for a signature' } } },
      { url: `${TRANSACTIONS_API}/${ID}/resume`, options: { method: 'POST' } },
    ]);
  });
});

describe('the reason', () => {
  it('trims and requires it', () => {
    assert.deepEqual(validateHoldReason('  waiting  '), { reason: 'waiting', error: null });
    for (const empty of ['', '   ', null, undefined]) assert.equal(validateHoldReason(empty).error, HOLD_MESSAGES.reasonRequired);
  });
  it('allows 500 characters and refuses 501 (the server rule)', () => {
    assert.equal(HOLD_REASON_MAX, 500);
    assert.equal(validateHoldReason('x'.repeat(500)).error, null);
    assert.equal(validateHoldReason('x'.repeat(501)).error, HOLD_MESSAGES.reasonTooLong);
    assert.equal(validateHoldReason(`  ${'x'.repeat(500)}  `).error, null);
  });
});

describe('which action is offered', () => {
  it('Hold needs the setting on AND an in-progress transaction', () => {
    assert.equal(canHold({ status: 'IN_PROGRESS' }, true), true);
    assert.equal(canHold({ status: 'IN_PROGRESS' }, false), false);
    assert.equal(canHold({ status: 'IN_PROGRESS' }, undefined), false);
    for (const status of ['ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED']) assert.equal(canHold({ status }, true), false, status);
  });
  it('Resume needs ON_HOLD and does not depend on the setting', () => {
    assert.equal(canResume({ status: 'ON_HOLD' }), true);
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED']) assert.equal(canResume({ status }), false, status);
    assert.equal(canResume(null), false);
  });
  it('status comes only from the server (timestamps are not looked at)', () => {
    assert.equal(canResume({ status: 'IN_PROGRESS', hold_started_at: '2026-10-23T00:00:00Z' }), false);
    assert.equal(canHold({ status: 'ON_HOLD', hold_started_at: null }, true), false);
  });
});

describe('held time', () => {
  it('formats the minutes the server reports', () => {
    assert.equal(formatHeldMinutes(0), '0 minutes');
    assert.equal(formatHeldMinutes(1), '1 minute');
    assert.equal(formatHeldMinutes(65), '1 hour 5 minutes');
    assert.equal(formatHeldMinutes(120), '2 hours');
    assert.equal(formatHeldMinutes(null), '0 minutes');
  });
});

describe('errors', () => {
  it('maps the real hold answers', () => {
    assert.equal(holdActionError(apiError(400, 'VALIDATION_ERROR', 'x', { reason: 'Enter a reason for the hold' }), 'hold').fieldError, 'Enter a reason for the hold');
    const off = holdActionError(apiError(409, 'HOLD_DISABLED'), 'hold');
    assert.deepEqual([off.kind, off.message, off.reload], ['hold_disabled', HOLD_MESSAGES.holdDisabled, true]);
    assert.equal(holdActionError(apiError(409, 'INVALID_STATE', 'x', { status: 'COMPLETED' }), 'hold').message, HOLD_MESSAGES.notInProgress);
    assert.equal(holdActionError(apiError(409, 'INVALID_STATE', 'x', { status: 'ON_HOLD' }), 'hold').message, HOLD_MESSAGES.alreadyOnHold);
    assert.equal(holdActionError(apiError(409, 'VERSION_CONFLICT'), 'hold').reload, true);
    assert.equal(holdActionError(apiError(403, 'FORBIDDEN'), 'hold').kind, 'forbidden');
    assert.equal(holdActionError(apiError(401, 'UNAUTHORIZED'), 'hold').kind, 'auth');
    assert.equal(holdActionError(apiError(404, 'NOT_FOUND'), 'hold').kind, 'notfound');
  });
  it('maps the real resume answers; Core down keeps it on hold and offers a retry', () => {
    const down = holdActionError(apiError(503, 'CALENDAR_UNAVAILABLE', 'raw server text'), 'resume');
    assert.deepEqual([down.kind, down.message, down.reload], ['calendar_unavailable', HOLD_MESSAGES.calendarDown, false]);
    assert.match(down.message, /still pending/);
    assert.equal(holdActionError(apiError(409, 'INVALID_STATE', 'x', { status: 'IN_PROGRESS' }), 'resume').message, HOLD_MESSAGES.notOnHold);
    assert.equal(holdActionError(apiError(500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'), 'resume').message, HOLD_MESSAGES.resumeServerError);
    const net = holdActionError(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.'), 'resume');
    assert.equal(net.kind, 'network');
    assert.equal(net.reload, true);
  });
  it('never shows raw server text for server errors', () => {
    assert.ok(!/pg\.js/.test(holdActionError(apiError(500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'), 'hold').message));
  });
  it('maps load failures', () => {
    assert.equal(loadErrorResult(apiError(403)).kind, 'forbidden');
    assert.equal(loadErrorResult(apiError(404)).kind, 'notfound');
    assert.equal(loadErrorResult(apiError(500)).kind, 'server');
  });
});

describe('the screen (source checks)', () => {
  const code = (read('src/app/transactions/[id]/page.js') + read('src/components/transactions/TransactionDetail.js')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('never edits status, hold time or minutes itself', () => {
    assert.ok(!/status\s*:\s*['"](ON_HOLD|IN_PROGRESS)['"]/.test(code));
    assert.ok(!/held_minutes\s*[:+]=|held_minutes\s*\+/.test(code));
    assert.ok(!/hold_started_at\s*[:=]\s*(null|new Date)/.test(code));
  });
  it('does not hardcode the setting as enabled and sends no client email, reference or audit data', () => {
    assert.ok(!/useState\(true\)/.test(code));
    assert.ok(/hold_enabled === true/.test(code));
    assert.ok(!/client_email|client_reference|audit/i.test(code));
  });
  it('guards against double submits and uses one call per action', () => {
    assert.ok(/busyRef\.current\) return/.test(code));
    assert.equal((code.match(/holdTransaction\(/g) ?? []).length, 1);
    assert.equal((code.match(/resumeTransaction\(/g) ?? []).length, 1);
  });
});
