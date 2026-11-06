import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { TRANSACTIONS_API, cancelTransaction } from '../../src/lib/api/transactions.js';
import { CANCEL_MESSAGES, CANCEL_REASON_MAX, canCancel, cancelErrorResult, cancelReconcileBanner, validateCancelReason } from '../../src/lib/ui/cancel-transaction.js';

// MOCKED fetchers and error objects shaped like the real contract (Operations cancel.js, access.js, dto.js).
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const ID = '33333333-3333-4333-8333-333333333333';

describe('the cancellation request', () => {
  it('POSTs /cancel with only the reason', async () => {
    const calls = [];
    await cancelTransaction(ID, 'Client left', async (url, options) => { calls.push({ url, options }); return {}; });
    assert.deepEqual(calls, [{ url: `${TRANSACTIONS_API}/${ID}/cancel`, options: { method: 'POST', body: { reason: 'Client left' } } }]);
  });
});

describe('who sees Cancel, and for which statuses', () => {
  it('Office Head and Super Admin see it for in-progress and on-hold transactions', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.SUPER_ADMIN]) {
      assert.equal(canCancel({ status: 'IN_PROGRESS' }, role), true, role);
      assert.equal(canCancel({ status: 'ON_HOLD' }, role), true, role);
    }
  });
  it('Office Staff and Executive never see it', () => {
    for (const role of [ROLES.OFFICE_STAFF, ROLES.EXECUTIVE, undefined, 'unknown']) {
      assert.equal(canCancel({ status: 'IN_PROGRESS' }, role), false, String(role));
      assert.equal(canCancel({ status: 'ON_HOLD' }, role), false, String(role));
    }
  });
  it('completed, cancelled and auto-closed transactions cannot be cancelled by anyone', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'AUTO_CLOSED']) for (const role of [ROLES.OFFICE_HEAD, ROLES.SUPER_ADMIN]) assert.equal(canCancel({ status }, role), false, `${status} ${role}`);
    assert.equal(canCancel(null, ROLES.SUPER_ADMIN), false);
  });
});

describe('the reason', () => {
  it('trims it and rejects empty or blank', () => {
    assert.deepEqual(validateCancelReason('  Client left  '), { reason: 'Client left', error: null });
    for (const blank of ['', '   ', '\n\t', null, undefined]) assert.equal(validateCancelReason(blank).error, CANCEL_MESSAGES.reasonRequired);
  });
  it('allows 500 characters and refuses 501 (the server rule)', () => {
    assert.equal(CANCEL_REASON_MAX, 500);
    assert.equal(validateCancelReason('x'.repeat(500)).error, null);
    assert.equal(validateCancelReason('x'.repeat(501)).error, CANCEL_MESSAGES.reasonTooLong);
  });
});

describe('errors', () => {
  it('maps 400, 401, 403 and 404', () => {
    assert.equal(cancelErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { reason: 'Enter a reason for cancelling' })).fieldError, 'Enter a reason for cancelling');
    for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [404, 'notfound']]) {
      const r = cancelErrorResult(apiError(status, 'X'));
      assert.deepEqual([r.kind, r.unknown], [kind, false]);
    }
  });
  it('a 409 means it is no longer open: read the state back, not an unknown outcome', () => {
    const r = cancelErrorResult(apiError(409, 'INVALID_STATE', 'x', { status: 'COMPLETED' }));
    assert.deepEqual([r.kind, r.message, r.reload, r.unknown], ['invalid_state', CANCEL_MESSAGES.notOpen, true, false]);
  });
  it('a network failure or server error is an unknown outcome and never shows raw text', () => {
    for (const e of [apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.'), apiError(500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'), apiError(502, 'X'), apiError(503, 'X')]) {
      const r = cancelErrorResult(e);
      assert.deepEqual([r.unknown, r.reload, r.message], [true, true, CANCEL_MESSAGES.unknownOutcome]);
    }
  });
  it('words the check by the server status (a cancelled transaction is not called completed)', () => {
    assert.match(cancelReconcileBanner('CANCELLED').message, /was cancelled/);
    assert.match(cancelReconcileBanner('IN_PROGRESS').message, /not cancelled/);
    assert.match(cancelReconcileBanner('ON_HOLD').message, /not cancelled/);
    assert.equal(cancelReconcileBanner('COMPLETED').message, CANCEL_MESSAGES.notOpen);
  });
});

describe('the screen (source checks)', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const page = strip((read('src/app/transactions/[id]/page.js') + read('src/components/transactions/TransactionDetail.js')));
  const rules = strip(read('src/lib/ui/cancel-transaction.js'));
  it('sends one cancel call, guarded, behind a dialog with an explicit confirm button', () => {
    assert.equal((page.match(/cancelTransaction\(/g) ?? []).length, 1);
    assert.ok(/busyRef\.current \|\| !canCancel\(tx, role\)/.test(page));
    assert.ok(/form="cancel-form"/.test(page));
  });
  it('withdraws every action when the state could not be read back', () => {
    assert.ok(/\{!outcomeUnknown && \(/.test(page));
    assert.ok((page.match(/if \(!fresh\) \{/g) ?? []).length >= 2);
  });
  it('invents no time, status, hold field or result, and sends no client data', () => {
    for (const code of [page, rules]) {
      // The only clock use on the page is the early check of a manually entered end time when completing; cancelling uses none.
      assert.ok(!/new Date\(|Date\.now\(/.test(code.replace('manualEndErrors(manualEnd, tx.started_at, Date.now())', '')));
      assert.ok(!/setTx\(\s*\{/.test(code));
      assert.ok(!/client_email|client_reference|audit/i.test(code));
    }
    assert.ok(!/hold_started_at\s*[:=]\s*null/.test(page));
  });
});
