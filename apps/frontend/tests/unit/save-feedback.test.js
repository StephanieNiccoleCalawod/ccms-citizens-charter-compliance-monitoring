import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, mock } from 'node:test';
import { ERROR_MS, MAX_TOASTS, SUCCESS_MS, getToasts, notify, resetNotifications } from '../../src/lib/ui/notify.js';
import { MESSAGES, saveFailureMessage, savedMessage } from '../../src/lib/ui/save-feedback.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });

afterEach(() => {
  mock.timers.reset();
  resetNotifications();
});

describe('the success sentence', () => {
  it('names the record and the operation', () => {
    assert.equal(savedMessage('Transaction', 'created'), 'Transaction created successfully.');
    assert.equal(savedMessage('Office', 'updated'), 'Office updated successfully.');
    assert.equal(savedMessage('Account', 'created'), 'Account created successfully.');
    assert.equal(savedMessage('Service', 'updated'), 'Service updated successfully.');
    assert.equal(savedMessage('Holiday', 'created'), 'Holiday created successfully.');
    assert.equal(savedMessage('Suspension', 'updated'), 'Suspension updated successfully.');
    assert.equal(savedMessage('Document', 'deleted'), 'Document deleted successfully.');
    assert.equal(savedMessage('', 'created'), 'Record created successfully.');
  });
});

describe('the one sentence for a failed save', () => {
  it('401 and 403 say the person is not authorized, with no server detail', () => {
    assert.equal(saveFailureMessage(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js:1')), MESSAGES.unauthorized);
    assert.equal(saveFailureMessage(apiError(401, 'UNAUTHORIZED')), 'You are not authorized to perform this action.');
  });
  it('no connection says it could not connect; a server error says something went wrong and hides the detail', () => {
    assert.equal(saveFailureMessage(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')), 'Unable to connect to the server. Please try again.');
    assert.equal(saveFailureMessage(apiError(500, 'INTERNAL_ERROR', 'pg: relation "offices" does not exist')), 'Something went wrong while saving. Please try again.');
    assert.equal(saveFailureMessage(apiError(503, 'X', 'boom')), MESSAGES.server);
  });
  it('a duplicate keeps the server\'s own sentence when it is clear, else the generic one', () => {
    assert.equal(saveFailureMessage(apiError(409, 'OFFICE_CODE_EXISTS', 'Office code already exists')), 'Office code already exists');
    assert.equal(saveFailureMessage(apiError(409, 'X', '')), 'This record already exists.');
    assert.equal(saveFailureMessage(apiError(409, 'X', 'at db.js:12 SELECT * FROM offices')), 'This record already exists.');
  });
  it('400 and 422 with field errors prompt to check the highlighted fields (the details sit under the fields)', () => {
    assert.equal(saveFailureMessage(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { office_name: 'required' })), 'Please check the highlighted fields and try again.');
    assert.equal(saveFailureMessage(apiError(422, 'X', 'x', { a: 'b' })), MESSAGES.validation);
  });
  it('a clear message without fields is kept (the page\'s own, then the server\'s); the rest is the unknown-error sentence', () => {
    assert.equal(saveFailureMessage(apiError(400, 'X', 'Services need at least one standard'), 'Own sentence'), 'Own sentence');
    assert.equal(saveFailureMessage(apiError(404, 'NOT_FOUND', 'Office not found')), 'Office not found');
    assert.equal(saveFailureMessage(apiError(404, 'X', 'TypeError: undefined is not a function')), 'Failed to save changes. Please try again.');
    assert.equal(saveFailureMessage(null), 'Failed to save changes. Please try again.');
    assert.equal(saveFailureMessage(apiError(418, 'X', '')), MESSAGES.unknown);
  });
  it('never lets internals through: stack traces, SQL, paths', () => {
    for (const bad of ['at handler (/srv/app/route.js:10:5)', 'SELECT * FROM accounts', 'Error: relation "x" does not exist', 'TypeError: x', 'node_modules/foo']) {
      assert.doesNotMatch(saveFailureMessage(apiError(400, 'X', bad)), /SELECT|relation|TypeError|node_modules|route\.js/, bad);
    }
  });
});

describe('the notification store', () => {
  it('shows a success once, and the same message twice in a row is still one notification', () => {
    notify.success('Office created successfully.');
    notify.success('Office created successfully.');
    assert.equal(getToasts().length, 1);
    assert.deepEqual([getToasts()[0].kind, getToasts()[0].message], ['success', 'Office created successfully.']);
  });
  it('keeps a success and an error apart, at most three at a time, and ignores empty messages', () => {
    notify.success('a');
    notify.error('b');
    notify.success('c');
    notify.error('d');
    assert.equal(getToasts().length, MAX_TOASTS);
    assert.deepEqual(getToasts().map((t) => t.message), ['b', 'c', 'd']);
    assert.equal(notify.success('   '), null);
    assert.equal(notify.error(undefined), null);
  });
  it('can be dismissed, and goes away by itself (success 5 s, error 8 s)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const id = notify.success('Saved');
    notify.error('Failed');
    notify.dismiss(id);
    assert.deepEqual(getToasts().map((t) => t.message), ['Failed']);
    notify.success('Again');
    mock.timers.tick(SUCCESS_MS);
    assert.deepEqual(getToasts().map((t) => t.message), ['Failed']);
    mock.timers.tick(ERROR_MS - SUCCESS_MS);
    assert.equal(getToasts().length, 0);
  });
});

describe('the toast and the save button (source checks, not a browser)', () => {
  const toaster = read('src/components/feedback/Toaster.js');
  const button = read('src/components/ui/SubmitButton.js');
  it('the toaster is drawn once, by the app shell, above modals, with a green check for success and a red alert for errors', () => {
    assert.ok(read('src/components/layout/AppShell.js').includes('<Toaster />'));
    assert.equal([...read('src/components/layout/AppShell.js').matchAll(/<Toaster/g)].length, 1);
    assert.ok(toaster.includes('z-[90]'));
    assert.ok(toaster.includes('border-emerald-200 bg-emerald-50') && toaster.includes('border-red-200 bg-red-50'));
    assert.ok(toaster.includes('CheckCircle') && toaster.includes('AlertCircle'));
    assert.ok(toaster.includes("role: 'status'") && toaster.includes("role: 'alert'"));
    assert.ok(toaster.includes('aria-label="Dismiss notification"'));
  });
  it('the save button shows a spinner and the busy label, and is disabled while busy', () => {
    assert.ok(button.includes('animate-spin'));
    assert.ok(button.includes('disabled={busy || disabled}'));
    assert.ok(button.includes('aria-busy={busy || undefined}'));
    assert.ok(button.includes('{busy ? busyLabel : label}'));
  });
});

const MODALS = [
  // [name, file, success sentences expected in the file, submit buttons expected]
  ['Add / Edit Account', 'src/app/accounts/page.js', ["savedMessage('Account', form.id ? 'updated' : 'created')"], 'account-form'],
  ['Add / Edit Office', 'src/app/offices/page.js', ["savedMessage('Office', form.id ? 'updated' : 'created')"], 'office-form'],
  ['Add / Edit Service', 'src/app/services/page.js', ["savedMessage('Service', 'updated')", "savedMessage('Service', 'created')"], 'service-form'],
  ['Edit Service, Add Document, Add standard version (details)', 'src/app/services/[id]/page.js', ["savedMessage('Service', 'updated')", "savedMessage('Document', doc.document_id ? 'updated' : 'created')", "savedMessage('Standard version', 'created')"], 'edit-service-form'],
  ['Add / Edit Holiday and Suspension', 'src/app/calendar/Holidays.js', ["'Suspension' : 'Holiday'"], 'exception-form'],
  ['Add Transaction', 'src/components/transactions/StartTransactionForm.js', ["savedMessage('Transaction', 'created')"], null],
];

describe('every save modal on the six pages reports its result the same way (source checks, not a browser)', () => {
  for (const [name, file, successes, formId] of MODALS) {
    const src = read(file);
    it(`${name}: success toast after the server answers, one failure toast, loading button, no duplicate banner`, () => {
      assert.ok(src.includes("import { notify } from"), 'uses the shared notify');
      for (const sentence of successes) assert.ok(src.includes(sentence), sentence);
      assert.ok(src.includes('notify.error(saveFailureMessage('), 'an error toast');
      assert.ok(src.includes('<SubmitButton'), 'the shared save button');
      if (formId) assert.ok(src.includes(`form="${formId}"`));
      assert.ok(!/setNotice\(/.test(src), 'no second, page-level success message');
      assert.ok(!src.includes('<ErrorBanner message={formError} />'), 'no second, in-modal error message');
    });
    it(`${name}: the success message comes after the request, the form is kept on a failure`, () => {
      // every success message has an awaited request shortly before it (it is said after the server answered)...
      const successes = [...src.matchAll(/notify\.success\(/g)].map((m) => m.index);
      assert.ok(successes.length > 0);
      for (const at of successes) assert.ok(src.slice(Math.max(0, at - 900), at).includes('await '), 'notify.success follows an awaited request');
      // ...and in the catch that reports a failure the form is never closed or cleared
      const errors = [...src.matchAll(/notify\.error\(saveFailureMessage\(/g)].map((m) => m.index);
      assert.ok(errors.length > 0);
      for (const at of errors) {
        const catchAt = src.lastIndexOf('} catch (err) {', at);
        if (catchAt < 0) continue; // a check made before the request is sent (nothing was sent, the form stays as it is)
        const body = src.slice(catchAt, at);
        for (const closer of ['setForm(null)', 'setEditForm(null)', 'setDoc(null)']) assert.ok(!body.includes(closer), `${closer} not in a failure`);
      }
    });
  }

  it('a double click sends one request: each save is guarded by a ref, a busy flag or the single-submit helper', () => {
    assert.ok(read('src/app/accounts/page.js').includes('if (busy) return; // one request at a time'));
    assert.ok(read('src/app/offices/page.js').includes('if (saving) return; // one request at a time'));
    assert.ok(read('src/app/services/page.js').includes('return once(async () => {'));
    assert.ok(read('src/app/services/[id]/page.js').includes('return once(async () => {'));
    assert.ok(read('src/app/calendar/Holidays.js').includes('if (!canWrite || saving) return;'));
    assert.ok(read('src/components/transactions/StartTransactionForm.js').includes('if (submittingRef.current || locked) return;'));
  });
  it('the confirmations that change data also report: deactivate, reactivate, reset, delete', () => {
    assert.ok(read('src/app/accounts/page.js').includes('was deactivated and signed out.') && read('src/app/accounts/page.js').includes('was reactivated.'));
    assert.ok(read('src/app/offices/page.js').includes("savedMessage('Office', active ? 'reactivated' : 'deactivated')"));
    assert.ok(read('src/app/services/page.js').includes("savedMessage('Service', active ? 'reactivated' : 'deactivated')"));
    assert.ok(read('src/app/services/[id]/page.js').includes("savedMessage('Document', 'deleted')"));
    assert.ok(read('src/app/calendar/Holidays.js').includes("'deleted'"));
  });
  it('the transaction actions (hold, resume, complete, cancel) send success and error to the same toast; warnings stay as banners', () => {
    const detail = read('src/components/transactions/TransactionDetail.js');
    assert.ok(detail.includes("if (next?.variant === 'success') notify.success(next.message);"));
    assert.ok(detail.includes("else if (next?.variant === 'error') notify.error(next.message);"));
    assert.ok(detail.includes('else setBanner(next);'));
  });
  it('the Add Transaction page no longer keeps its own success banner, and the Logs page has no save modal to change', () => {
    assert.ok(!read('src/app/transactions/page.js').includes('setCreated'));
    assert.ok(!/method: '(POST|PUT|PATCH|DELETE)'/.test(read('src/app/logs/page.js')));
  });
});
