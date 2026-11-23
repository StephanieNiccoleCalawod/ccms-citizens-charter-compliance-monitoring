// TT3 / S8-07 (FE part): ticketing, partner systems, mail and receipt storage can be down. The screen must say plainly what was and
// was not saved, never claim a save that did not happen, and never retry a write for the person (a gateway timeout may have saved it).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { MESSAGES as SAVE, saveFailureMessage } from '../../src/lib/ui/save-feedback.js';
import { MESSAGES as START, startErrorResult } from '../../src/lib/ui/start-transaction.js';
import { RECEIPT_MESSAGES, receiptFailure } from '../../src/lib/ui/receipts.js';
import { isAmbiguousWrite } from '../../src/lib/ui/backdate.js';
import { fmsCard, smsCard } from '../../src/lib/ui/sync-status.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x') => Object.assign(new Error(message), { name: 'ApiError', status, code, details: null });

describe('gateway 502 / 504 on a write (item 5, AC4)', () => {
  it('says the outcome cannot be confirmed and asks the person to check first', () => {
    for (const status of [502, 504]) {
      const message = saveFailureMessage(apiError(status, 'UPSTREAM'));
      assert.equal(message, SAVE.gateway);
      assert.match(message, /cannot confirm your change was saved/i);
      assert.match(message, /check the record before trying again/i);
    }
  });

  it('a 503 says the change was not saved; other 5xx keep the generic sentence', () => {
    assert.match(saveFailureMessage(apiError(503, 'X')), /was not saved/i);
    assert.equal(saveFailureMessage(apiError(500, 'X')), SAVE.server);
  });

  it('Start treats a gateway timeout as "may or may not be recorded", not as a catalogue problem', () => {
    for (const status of [502, 504]) {
      const result = startErrorResult(apiError(status, 'UPSTREAM'));
      assert.equal(result.kind, 'gateway_timeout');
      assert.equal(result.message, START.gatewayTimeout);
      assert.match(result.message, /cannot confirm the transaction was started/i);
      assert.match(result.message, /not recorded twice/i);
      assert.equal(isAmbiguousWrite(apiError(status, 'UPSTREAM')), true);
    }
    assert.equal(startErrorResult(apiError(504, 'CATALOGUE_UNAVAILABLE')).kind, 'unavailable', 'a catalogue refusal keeps its own message');
  });

  it('nothing in the browser layer retries a write on its own (only one re-send after a 401, before the server processed it)', () => {
    const session = read('src/lib/auth/session.js');
    const body = session.slice(session.indexOf('async function sendRequest'));
    assert.match(body, /response\.status === 401 && !retried/);
    assert.doesNotMatch(body, /502|504|setTimeout|setInterval|for \(let attempt|while \(/, 'no retry loop or backoff');
    assert.doesNotMatch(read('src/components/transactions/StartTransactionForm.js'), /setTimeout|setInterval/);
  });
});

describe('receipt storage (item 4, AC4)', () => {
  it('storage down or not set up: says the receipt was not saved, whatever text the server sent', () => {
    const failure = receiptFailure(apiError(503, 'RECEIPT_STORAGE_UNAVAILABLE', 'Receipt storage is not configured'));
    assert.equal(failure.message, RECEIPT_MESSAGES.storageDown);
    assert.match(failure.message, /was not saved/i);
    assert.doesNotMatch(failure.message, /attached|uploaded successfully/i);
  });

  it('no answer in time: says it could not be confirmed, and the panel reads the receipt again', () => {
    for (const error of [apiError(504, 'UPSTREAM'), apiError(502, 'UPSTREAM'), apiError(0, 'NETWORK_ERROR')]) {
      const failure = receiptFailure(error);
      assert.equal(failure.message, RECEIPT_MESSAGES.unconfirmed);
      assert.equal(failure.recheck, true);
    }
    assert.match(read('src/components/transactions/ReceiptPanel.js'), /RECEIPT_EXISTS' \|\| recheck/);
  });

  it('"Receipt attached." is only said after the server accepted the upload', () => {
    const panel = read('src/components/transactions/ReceiptPanel.js');
    const from = panel.indexOf('async function submit');
    const submit = panel.slice(from, panel.indexOf('async function', from + 10));
    const successAt = submit.indexOf("notify.success('Receipt attached.')");
    assert.ok(successAt > submit.indexOf('await uploadReceipt'), 'after the awaited upload');
    assert.ok(successAt < submit.indexOf('} catch'), 'inside the success path, not the catch');
  });
});

describe('ticketing, partner systems and mail (items 1 to 3)', () => {
  it('ticketing down: the form says the queue could not be loaded and that a start without a ticket still works', () => {
    assert.match(read('src/components/transactions/StartTransactionForm.js'), /The queue could not be loaded\. You can still start without a ticket\./);
  });

  it('FMS / SMS failures say the changes are saved and use truthful statuses', () => {
    const failed = fmsCard({ fms_last_push: { status: 'FAILED', at: '2026-11-23T01:00:00Z' } });
    assert.equal(failed.badge, 'Failed');
    assert.match(failed.text, /your changes are saved/i);
    const rejected = fmsCard({ fms_last_push: { status: 'FAILED', error_code: 'KEY_REJECTED', at: '2026-11-23T01:00:00Z' } });
    assert.equal(rejected.badge, 'Key refused');
    assert.match(rejected.text, /Automatic retries have stopped/i);
    assert.equal(smsCard({ sms_issue: { state: 'KEY_REJECTED' } }).badge, 'Key refused');
    assert.equal(fmsCard({ fms_last_push: { status: 'PENDING', at: '2026-11-23T01:00:00Z' } }).badge, 'Pending', 'not "Synced" until the partner accepted it');
  });

  it('mail: the slip prints without an email, and the screens never claim an email was sent', () => {
    assert.match(read('src/components/transactions/AcknowledgementSlip.js'), /whether or not the acknowledgement email was sent/i);
    assert.match(read('src/components/transactions/TransactionDetail.js'), /needs no email and no successful send/i);
    for (const file of ['src/components/transactions/StartTransactionForm.js', 'src/components/transactions/TransactionDetail.js', 'src/components/transactions/AcknowledgementSlip.js']) {
      assert.doesNotMatch(read(file), /(?<!whether or not the acknowledgement )email (was|has been) sent|we (have )?emailed|emailed (you|the client)/i, file);
    }
  });
});
