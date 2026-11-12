// CC050: choosing Granted or Disapproved in the Complete dialog, and showing the stored outcome. Pure helpers plus source checks.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { TRANSACTIONS_API, completeTransaction } from '../../src/lib/api/transactions.js';
import { completionBody } from '../../src/lib/ui/backdate.js';
import {
  DISAPPROVAL_REASON_MAX, EMPTY_OUTCOME, NOTICE_LABEL, NOT_RECORDED_LABEL, OUTCOME_FIELDS, OUTCOME_LABELS, OUTCOME_MESSAGES,
  chooseOutcome, completeErrorResult, completeRequestBody, outcomeBody, outcomeErrors, outcomeLabel,
} from '../../src/lib/ui/complete-transaction.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const ID = '33333333-3333-4333-8333-333333333333';
const disapproved = (over = {}) => ({ outcome: 'DISAPPROVED', reason: 'Missing signature', notice: true, ...over });

describe('the choice', () => {
  it('starts empty: the dialog never defaults to either decision, and nothing chosen is an error on outcome', () => {
    assert.deepEqual(EMPTY_OUTCOME, { outcome: '', reason: '', notice: false });
    assert.deepEqual(outcomeErrors(EMPTY_OUTCOME), { outcome: OUTCOME_MESSAGES.outcome });
    assert.deepEqual(outcomeErrors({ outcome: 'APPROVED' }), { outcome: OUTCOME_MESSAGES.outcome });
    assert.deepEqual(outcomeErrors(null), { outcome: OUTCOME_MESSAGES.outcome });
  });

  it('Granted needs neither a reason nor the tick', () => {
    assert.deepEqual(outcomeErrors({ outcome: 'GRANTED', reason: '', notice: false }), {});
    assert.deepEqual(outcomeBody({ outcome: 'GRANTED', reason: 'left over', notice: true }), { outcome: 'GRANTED' });
  });

  it('Disapproved: missing reason, whitespace reason, overlong reason and missing tick are each named', () => {
    assert.deepEqual(outcomeErrors(disapproved({ reason: '' })), { disapproval_reason: OUTCOME_MESSAGES.reason });
    assert.deepEqual(outcomeErrors(disapproved({ reason: '    ' })), { disapproval_reason: OUTCOME_MESSAGES.reason });
    assert.deepEqual(outcomeErrors(disapproved({ reason: 'x'.repeat(DISAPPROVAL_REASON_MAX + 1) })), { disapproval_reason: OUTCOME_MESSAGES.reason });
    assert.deepEqual(outcomeErrors(disapproved({ notice: false })), { disapproval_notice_given: OUTCOME_MESSAGES.notice });
    assert.deepEqual(outcomeErrors(disapproved({ reason: '', notice: false })), { disapproval_reason: OUTCOME_MESSAGES.reason, disapproval_notice_given: OUTCOME_MESSAGES.notice });
    assert.deepEqual(outcomeErrors(disapproved({ reason: ` ${'x'.repeat(DISAPPROVAL_REASON_MAX)} ` })), {}, '1,000 characters after trimming is allowed');
  });

  it('a valid Disapproved sends the trimmed reason and the tick with the existing API field names', () => {
    assert.deepEqual(outcomeBody(disapproved({ reason: '  Missing signature  ' })), { outcome: 'DISAPPROVED', disapproval_reason: 'Missing signature', disapproval_notice_given: true });
    assert.deepEqual(OUTCOME_FIELDS, ['outcome', 'disapproval_reason', 'disapproval_notice_given']);
    assert.equal(DISAPPROVAL_REASON_MAX, 1000);
    assert.equal(NOTICE_LABEL, 'Written notice of disapproval given to the client');
  });

  it('switching the decision clears the hidden disapproval fields; choosing the same one keeps them', () => {
    const typed = disapproved({ reason: 'Typed then hidden' });
    assert.deepEqual(chooseOutcome(typed, 'GRANTED'), { outcome: 'GRANTED', reason: '', notice: false });
    assert.deepEqual(chooseOutcome(chooseOutcome(typed, 'GRANTED'), 'DISAPPROVED'), { outcome: 'DISAPPROVED', reason: '', notice: false }, 'nothing comes back');
    assert.equal(chooseOutcome(typed, 'DISAPPROVED'), typed);
    assert.deepEqual(chooseOutcome(typed, 'NOPE'), EMPTY_OUTCOME);
  });

  it('the request body combines the outcome with the manual end time and keeps the hold/backdate fields as they were', () => {
    assert.deepEqual(completeRequestBody({ outcome: 'GRANTED' }, undefined), { outcome: 'GRANTED' });
    const manual = completionBody({ enabled: true, ended_at: '2026-10-20T09:45', reason: '  Finished earlier ' });
    assert.deepEqual(completeRequestBody(disapproved(), manual), { outcome: 'DISAPPROVED', disapproval_reason: 'Missing signature', disapproval_notice_given: true, ended_at: '2026-10-20T09:45:00+08:00', backdate_reason: 'Finished earlier' });
  });

  it('POSTs the body to /complete', async () => {
    const calls = [];
    await completeTransaction(ID, async (url, options) => { calls.push({ url, options }); return {}; }, { outcome: 'GRANTED' });
    assert.deepEqual(calls, [{ url: `${TRANSACTIONS_API}/${ID}/complete`, options: { method: 'POST', body: { outcome: 'GRANTED' } } }]);
  });
});

describe('server field errors', () => {
  it('a 400 naming the outcome fields is shown next to those fields (the dialog stays open)', () => {
    const r = completeErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { disapproval_reason: 'Enter the reason for disapproval (up to 1,000 characters)', disapproval_notice_given: 'Confirm the notice' }));
    assert.equal(r.kind, 'validation');
    assert.deepEqual(r.fieldErrors, { disapproval_reason: 'Enter the reason for disapproval (up to 1,000 characters)', disapproval_notice_given: 'Confirm the notice' });
    assert.deepEqual(completeErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { outcome: 'Choose Granted or Disapproved' })).fieldErrors, { outcome: 'Choose Granted or Disapproved' });
    assert.deepEqual(completeErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { ended_at: 'End must be after start' })).fieldErrors, { ended_at: 'End must be after start' }, 'the manual-end errors still work');
  });
});

describe('the stored outcome as shown', () => {
  it('a completed transaction shows Granted, Disapproved, or Not recorded for an old (null) one', () => {
    assert.equal(outcomeLabel({ status: 'COMPLETED', outcome: 'GRANTED' }), 'Granted');
    assert.equal(outcomeLabel({ status: 'COMPLETED', outcome: 'DISAPPROVED' }), 'Disapproved');
    assert.equal(outcomeLabel({ status: 'COMPLETED', outcome: null }), NOT_RECORDED_LABEL);
    assert.equal(outcomeLabel({ status: 'COMPLETED' }), 'Not recorded');
    assert.deepEqual(OUTCOME_LABELS, { GRANTED: 'Granted', DISAPPROVED: 'Disapproved' });
  });
  it('an in-progress, held, cancelled or auto-closed transaction has no completion outcome', () => {
    for (const status of ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'AUTO_CLOSED']) {
      assert.equal(outcomeLabel({ status, outcome: 'GRANTED' }), null, status);
      assert.equal(outcomeLabel({ status, outcome: null }), null, status);
    }
    assert.equal(outcomeLabel(null), null);
  });
});

describe('the dialog and the detail (source checks)', () => {
  const detail = strip(read('src/components/transactions/TransactionDetail.js'));
  const list = strip(read('src/app/transactions/page.js'));

  it('offers Granted and Disapproved as radios, and the reason box and notice tick only for Disapproved', () => {
    assert.ok(detail.includes('OUTCOMES.map((value)'));
    assert.ok(detail.includes('type="radio" name="complete-outcome"'));
    assert.ok(detail.includes("outcomeChoice.outcome === 'DISAPPROVED' ? ("));
    assert.ok(detail.includes('maxLength={DISAPPROVAL_REASON_MAX}'));
    assert.ok(detail.includes('id="complete-disapproval-notice" type="checkbox"'));
    assert.ok(detail.includes('{NOTICE_LABEL}'));
  });

  it('checks the outcome before sending, sends one completion with the outcome, and shows the server\'s field errors', () => {
    assert.ok(detail.includes('const earlyOutcome = outcomeErrors(outcomeChoice);'));
    assert.ok(detail.includes('completeTransaction(id, undefined, completeRequestBody(outcomeChoice, completionBody(manualEnd)))'));
    assert.equal((detail.match(/completeTransaction\(/g) ?? []).length, 1);
    assert.ok(detail.includes('OUTCOME_FIELDS.filter((f) => named[f])'));
    for (const id of ['complete-outcome-error', 'complete-disapproval-reason-error', 'complete-disapproval-notice-error']) assert.ok(detail.includes(`id="${id}"`), id);
  });

  it('every opening and closing of the dialog starts from no decision (nothing carries over between attempts or transactions)', () => {
    const open = detail.slice(detail.indexOf('function openCompleteDialog()'), detail.indexOf('function closeCompleteDialog()'));
    const close = detail.slice(detail.indexOf('function closeCompleteDialog()'), detail.indexOf('function pickOutcome('));
    for (const part of [open, close]) {
      assert.ok(part.includes('setOutcomeChoice({ ...EMPTY_OUTCOME })'));
      assert.ok(part.includes('setOutcomeFieldErrors({})'));
    }
    assert.ok(detail.includes('onCancel={closeCompleteDialog}'));
    assert.ok(detail.includes('setOutcomeChoice((choice) => chooseOutcome(choice, outcome))'));
  });

  it('the detail and the list show the outcome label; the reason text is never shown by either', () => {
    assert.ok(detail.includes('const outcomeText = outcomeLabel(tx);'));
    assert.ok(detail.includes('label="Outcome" testId="outcome"'));
    assert.ok(list.includes('const decision = outcomeLabel(t);'));
    assert.doesNotMatch(detail + list, /tx\.disapproval_reason|t\.disapproval_reason/);
  });

  it('Cancel stays its own action with its own dialog and API call', () => {
    assert.ok(detail.includes('form="cancel-form"'));
    assert.equal((detail.match(/cancelTransaction\(/g) ?? []).length, 1);
    const cancelForm = detail.slice(detail.indexOf('<form id="cancel-form"'), detail.indexOf('</form>', detail.indexOf('<form id="cancel-form"')));
    assert.doesNotMatch(cancelForm, /outcome/i);
  });
});
