import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { TRANSACTIONS_API, completeTransaction } from '../../src/lib/api/transactions.js';
import { COMPLETE_MESSAGES, COMPLIANCE_LABELS, canComplete, complianceState, completeErrorResult, describeElapsed, describeVariance, mustResumeFirst, reconcileBanner } from '../../src/lib/ui/complete-transaction.js';

// MOCKED fetchers and error objects shaped like the real contract (Operations complete.js, dto.js, compliance.js).
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const ID = '33333333-3333-4333-8333-333333333333';

describe('the completion request', () => {
  it('POSTs /complete with no body (the server uses its own clock)', async () => {
    const calls = [];
    await completeTransaction(ID, async (url, options) => { calls.push({ url, options }); return {}; });
    assert.deepEqual(calls, [{ url: `${TRANSACTIONS_API}/${ID}/complete`, options: { method: 'POST' } }]);
  });
});

describe('which action is offered', () => {
  it('Complete only for IN_PROGRESS', () => {
    assert.equal(canComplete({ status: 'IN_PROGRESS' }), true);
    for (const status of ['ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED']) assert.equal(canComplete({ status }), false, status);
    assert.equal(canComplete(null), false);
  });
  it('an ON_HOLD transaction is told to resume first', () => {
    assert.equal(mustResumeFirst({ status: 'ON_HOLD' }), true);
    assert.equal(mustResumeFirst({ status: 'IN_PROGRESS' }), false);
  });
});

describe('compliance state comes only from the server\'s fields', () => {
  it('compliant and breach', () => {
    assert.equal(complianceState({ status: 'COMPLETED', is_compliant: true, elapsed_working_minutes: 30, variance_minutes: -5 }), 'compliant');
    assert.equal(complianceState({ status: 'COMPLETED', is_compliant: false, elapsed_working_minutes: 90, variance_minutes: 20 }), 'breach');
  });
  it('pending only when completed and nothing was stored', () => {
    assert.equal(complianceState({ status: 'COMPLETED', is_compliant: null, elapsed_working_minutes: null, variance_minutes: null, ended_at: '2026-10-23T05:00:00Z' }), 'pending');
  });
  it('is never pending for a transaction that is not completed, and ended_at alone decides nothing', () => {
    for (const status of ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'AUTO_CLOSED']) assert.equal(complianceState({ status, is_compliant: null, elapsed_working_minutes: null }), 'none', status);
    assert.equal(complianceState({ status: 'IN_PROGRESS', ended_at: '2026-10-23T05:00:00Z', is_compliant: null }), 'none');
    assert.equal(complianceState(null), 'none');
  });
  it('a stored result wins whatever the elapsed time looks like', () => {
    assert.equal(complianceState({ status: 'COMPLETED', is_compliant: false, elapsed_working_minutes: 1, variance_minutes: -999 }), 'breach');
  });
});

describe('values the server returned, only worded', () => {
  it('variance (backend sign convention): negative = early, positive = late, zero = exactly on time', () => {
    assert.equal(describeVariance(-5), 'Early by 5 minutes');
    assert.equal(describeVariance(1), 'Late by 1 minute');
    assert.equal(describeVariance(90), 'Late by 1 hour 30 minutes');
    assert.equal(describeVariance(-120), 'Early by 2 hours');
    assert.equal(describeVariance(0), 'On time (exactly at the standard)');
    assert.equal(describeVariance(null), null);
    assert.equal(describeVariance('abc'), null);
  });
  it('timeliness and result labels are display-only changes', () => {
    assert.deepEqual(COMPLIANCE_LABELS, { compliant: 'On time', breach: 'Late', pending: 'Awaiting result' });
  });
  it('elapsed minutes', () => {
    assert.equal(describeElapsed(61), '61 minutes');
    assert.equal(describeElapsed(1), '1 minute');
    assert.equal(describeElapsed(null), null);
  });
});

describe('errors', () => {
  it('conflicts say what the status is now and reload', () => {
    const hold = completeErrorResult(apiError(409, 'INVALID_STATE', 'x', { status: 'ON_HOLD' }));
    assert.deepEqual([hold.kind, hold.message, hold.reload, hold.unknown], ['on_hold', COMPLETE_MESSAGES.mustResume, true, false]);
    assert.equal(completeErrorResult(apiError(409, 'INVALID_STATE', 'x', { status: 'COMPLETED' })).message, COMPLETE_MESSAGES.alreadyCompleted);
    assert.equal(completeErrorResult(apiError(409, 'INVALID_STATE', 'x', { status: 'CANCELLED' })).message, COMPLETE_MESSAGES.notInProgress);
  });
  it('401, 403 and 404 are shown as they are and are not "unknown"', () => {
    for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [404, 'notfound']]) {
      const r = completeErrorResult(apiError(status, 'X'));
      assert.deepEqual([r.kind, r.unknown], [kind, false]);
    }
  });
  it('a network failure or server error is an unknown outcome: read the state back, do not resubmit', () => {
    for (const e of [apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.'), apiError(500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'), apiError(503, 'X'), apiError(502, 'X')]) {
      const r = completeErrorResult(e);
      assert.equal(r.unknown, true);
      assert.equal(r.reload, true);
      assert.equal(r.message, COMPLETE_MESSAGES.unknownOutcome);
      assert.ok(!/pg\.js|TypeError/.test(r.message));
    }
  });
  it('shows the server\'s own text for a time-order validation error', () => {
    const r = completeErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { ended_at: 'End must be after start' }));
    assert.equal(r.message, 'End must be after start');
  });
});

describe('after an unclear outcome the server status decides the message', () => {
  it('words each status without calling a cancelled transaction completed', () => {
    assert.equal(reconcileBanner('IN_PROGRESS').message, COMPLETE_MESSAGES.stillInProgressAfterUnknown);
    assert.equal(reconcileBanner('COMPLETED').message, COMPLETE_MESSAGES.completedAfterUnknown);
    assert.equal(reconcileBanner('ON_HOLD').message, COMPLETE_MESSAGES.mustResume);
    assert.equal(reconcileBanner('CANCELLED').message, COMPLETE_MESSAGES.notInProgress);
  });
});

describe('the screen and helpers (source checks)', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const page = strip((read('src/app/transactions/[id]/page.js') + read('src/components/transactions/TransactionDetail.js')));
  const rules = strip(read('src/lib/ui/complete-transaction.js'));
  const api = strip(read('src/lib/api/transactions.js'));
  it('uses no browser clock and does no compliance arithmetic', () => {
    for (const code of [page, rules, api]) {
      // The one allowed use of the clock is the early "not in the future" check of a manually entered end time; it is never sent.
      assert.ok(!/new Date\(|Date\.now\(|performance\.now/.test(code.replace('manualEndErrors(manualEnd, tx.started_at, Date.now())', '')));
      assert.ok(!/elapsed_working_minutes\s*[-+*<>]|variance_minutes\s*[-+*<>]|is_compliant\s*=[^=]/.test(code));
    }
  });
  it('never sets the status, end time or result itself', () => {
    // The only ended_at in the page's own code is what the person types into the manual-end field; none is made up.
    assert.ok(!/ended_at\s*[:=]\s*(new Date|Date\.|Number|Math\.)/.test(page));
    assert.ok(!/(tx|fresh|data)\.ended_at\s*=[^=]/.test(page));
    assert.ok(!/setTx\(\s*\{/.test(page));
  });
  it('withdraws Complete whenever the state could not be read back after a completion attempt', () => {
    assert.equal((page.match(/if \(!fresh\) setOutcomeUnknown\(true\)/g) ?? []).length, 2);
  });
  it('asks for confirmation, guards repeats, and sends no client data or job calls', () => {
    assert.ok(/ConfirmDialog/.test(page));
    assert.ok(/busyRef\.current \|\| !canComplete\(tx\)/.test(page));
    assert.equal((page.match(/completeTransaction\(/g) ?? []).length, 1);
    assert.ok(!/client_email|client_reference|audit|compute-pending|jobs\//i.test(page + rules + api));
  });
});
