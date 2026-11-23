// S8-37 (FE): immediate feedback, no double submits, and safe recovery.
//   AC1  clicking Start twice quickly creates one transaction
//   AC2  an error puts the focus on the field to fix
//   AC3  nothing silently discards typed data when it can be kept (the warning before leaving)
// Recovery after a session expires (S8-33) waits for that decision: the session timer was removed, so there is nothing to recover from yet.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { singleFlight, writeKey } from '../../src/lib/auth/single-flight.js';
import { firstInvalidIn, installFocusFirstError, scopeOf } from '../../src/lib/ui/focus-first-error.js';
import { createDirtyRegistry } from '../../src/lib/ui/dirty-registry.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('one write for one click (AC1)', () => {
  it('a second identical write made while the first is running is not sent: it gets the first one\'s answer', async () => {
    const inFlight = new Map();
    let sent = 0;
    let release;
    const start = () => new Promise((resolve) => { sent += 1; release = () => resolve({ tracking_no: 'REG-1' }); });
    const key = writeKey('POST', '/api/operations/transactions', { service_id: 's1', client_type: 'STUDENT' });
    const first = singleFlight(inFlight, key, start);
    const second = singleFlight(inFlight, key, start);
    const third = singleFlight(inFlight, key, start);
    assert.equal(sent, 1, 'only one request was started');
    release();
    assert.deepEqual(await first, { tracking_no: 'REG-1' });
    assert.equal(await second, await first, 'every click receives the same answer');
    assert.equal(await third, await first);
  });

  it('once it has answered, a deliberate repeat is sent normally; a failure is forgotten too', async () => {
    const inFlight = new Map();
    let sent = 0;
    const key = writeKey('POST', '/x', { a: 1 });
    await singleFlight(inFlight, key, async () => { sent += 1; return 'ok'; });
    await singleFlight(inFlight, key, async () => { sent += 1; return 'ok'; });
    assert.equal(sent, 2);
    await assert.rejects(singleFlight(inFlight, key, async () => { throw new Error('refused'); }), /refused/);
    await singleFlight(inFlight, key, async () => { sent += 1; return 'ok'; });
    assert.equal(sent, 3, 'a request that failed does not block the next try');
    assert.equal(inFlight.size, 0);
  });

  it('a different body, address or method is a different write; a read or an upload is never held back', () => {
    const base = writeKey('POST', '/api/operations/transactions', { service_id: 's1' });
    assert.notEqual(base, writeKey('POST', '/api/operations/transactions', { service_id: 's2' }));
    assert.notEqual(base, writeKey('PUT', '/api/operations/transactions', { service_id: 's1' }));
    assert.notEqual(base, writeKey('POST', '/api/operations/other', { service_id: 's1' }));
    assert.equal(writeKey('GET', '/api/x', undefined), null);
    assert.equal(writeKey('HEAD', '/api/x'), null);
    assert.equal(writeKey('POST', '/api/receipt', {}, { isForm: true }), null);
    const circular = {}; circular.self = circular;
    assert.equal(writeKey('POST', '/x', circular), null, 'a body that cannot be compared is always sent');
    assert.equal(writeKey('POST', '/x', undefined), 'POST /x ', 'a write with no body (Call next, Resume) is held too');
  });

  it('two requests with no key are both started', async () => {
    let sent = 0;
    await Promise.all([singleFlight(new Map(), null, async () => { sent += 1; }), singleFlight(new Map(), null, async () => { sent += 1; })]);
    assert.equal(sent, 2);
  });

  it('is under every screen: apiFetch itself holds the second identical write, and the 401 re-send goes straight through', () => {
    const session = read('src/lib/auth/session.js');
    assert.match(session, /export function apiFetch\(path, options = \{\}, retried = false\) \{\s*if \(retried\) return sendRequest\(path, options, true\);/);
    assert.match(session, /singleFlight\(writesInFlight, writeKey\(options\.method, path, options\.body, \{ isForm \}\)/);
    assert.match(session, /return apiFetch\(path, \{ method, body, headers \}, true\);/);
  });

  it('the screens that already guard themselves still do (a second line, not a replacement)', () => {
    for (const file of ['src/components/transactions/StartTransactionForm.js', 'src/components/transactions/TransactionDetail.js']) assert.match(read(file), /submittingRef|busyRef/, file);
    assert.match(read('src/components/transactions/StartTransactionForm.js'), /if \(submittingRef\.current\) return;/);
  });
});

describe('the server is the second line for Start and Complete (read from the backend source, nothing changed there)', () => {
  const be = (path) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

  it('Start: one open transaction per staff account and per counter, enforced by the database', () => {
    const start = be('operations-service/src/modules/transaction/start.js');
    assert.match(start, /transactions_one_open_per_staff_uq/);
    assert.match(start, /transactions_one_open_per_counter_uq/);
    assert.match(start, /OPEN_TRANSACTION_EXISTS/);
  });

  it('Complete: a second Complete on a finished transaction is refused, not applied again', () => {
    const complete = be('operations-service/src/modules/transaction/complete.js');
    assert.match(complete, /This transaction is already \$\{statusWord\(current\.status\)\}/);
    assert.match(complete, /'INVALID_STATE'/);
  });
});

describe('an error puts the focus on the field to fix (AC2)', () => {
  // A stand-in for the browser: just enough to see when the watcher looks and where it puts the focus.
  function fakeBrowser() {
    const listeners = {};
    const field = (name, invalid) => ({ name, invalid, focused: false, focus() { this.focused = true; doc.activeElement = this; } });
    const frames = [];
    let observerCallback = null;
    const scope = { fields: [], querySelector() { return this.fields.find((f) => f.invalid) ?? null; }, closest() { return null; }, ownerDocument: null };
    const view = {
      requestAnimationFrame: (fn) => frames.push(fn),
      setTimeout: (fn) => { view.timeoutFn = fn; return 1; },
      clearTimeout: () => {},
      MutationObserver: class { constructor(cb) { observerCallback = cb; } observe() {} disconnect() { observerCallback = null; } },
    };
    const doc = { defaultView: view, activeElement: null, addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: () => {} };
    scope.ownerDocument = doc;
    const submit = () => listeners.submit({ target: { closest: () => scope, ownerDocument: doc } });
    return { doc, scope, field, submit, runFrame: () => frames.shift()?.(), notifyChange: () => observerCallback?.(), observing: () => observerCallback !== null, view };
  }

  it('focuses the first invalid field of the submitted form right after a submit that found a problem', () => {
    const b = fakeBrowser();
    installFocusFirstError(b.doc);
    const email = b.field('email', false);
    const name = b.field('name', true);
    const code = b.field('code', true);
    b.scope.fields = [email, name, code];
    b.submit();
    b.runFrame();
    assert.equal(name.focused, true, 'the first invalid field');
    assert.equal(code.focused, false);
    assert.equal(b.observing(), false, 'it stops once it has done its job');
  });

  it('a problem that comes back from the server a moment later gets the focus too', () => {
    const b = fakeBrowser();
    installFocusFirstError(b.doc);
    const name = b.field('name', false);
    b.scope.fields = [name];
    b.submit();
    b.runFrame();
    assert.equal(b.observing(), true, 'nothing wrong yet: it keeps watching for a few seconds');
    name.invalid = true; // the answer arrives and the form marks the field
    b.notifyChange();
    assert.equal(name.focused, true);
    assert.equal(b.observing(), false);
  });

  it('does nothing without a submit: a field marked invalid while someone types never takes the focus', () => {
    const b = fakeBrowser();
    installFocusFirstError(b.doc);
    const name = b.field('name', true);
    b.scope.fields = [name];
    b.runFrame();
    b.notifyChange();
    assert.equal(name.focused, false);
  });

  it('does not move the focus again when the invalid field already has it, and the watching ends after its time', () => {
    const b = fakeBrowser();
    installFocusFirstError(b.doc);
    const name = b.field('name', true);
    b.scope.fields = [name];
    b.doc.activeElement = name;
    b.submit();
    b.runFrame();
    assert.equal(name.focused, false, 'already focused: left alone');
    const quiet = fakeBrowser();
    installFocusFirstError(quiet.doc);
    quiet.scope.fields = [quiet.field('x', false)];
    quiet.submit();
    quiet.runFrame();
    assert.equal(quiet.observing(), true);
    quiet.view.timeoutFn();
    assert.equal(quiet.observing(), false, 'after a few seconds it stops looking');
  });

  it('finds the first invalid, enabled, visible field and the form or dialog a submit belongs to', () => {
    const root = { querySelector: (selector) => (selector.includes('[aria-invalid="true"]') && selector.includes(':not([disabled])') ? 'field' : null) };
    assert.equal(firstInvalidIn(root), 'field');
    assert.equal(firstInvalidIn(null), null);
    assert.equal(scopeOf({ closest: (s) => (/form, \[role="dialog"\]/.test(s) ? 'the form' : null) }), 'the form');
    assert.equal(scopeOf({ closest: () => null, ownerDocument: { body: 'body' } }), 'body');
  });

  it('a form that shows the red sentence under a field without marking the field still gets the focus on that field', () => {
    const input = { id: 'office_name' };
    const wrapper = { querySelectorAll: () => [input], parentElement: null };
    const message = { parentElement: wrapper };
    const root = { querySelector: (selector) => (selector.includes('aria-invalid') ? null : message) };
    assert.equal(firstInvalidIn(root), input);
    const deeper = { parentElement: { querySelectorAll: () => [], parentElement: wrapper } };
    assert.equal(firstInvalidIn({ querySelector: (selector) => (selector.includes('aria-invalid') ? null : deeper) }), input, 'found one level up');
  });

  it('but a banner above a whole form (many fields) is not mistaken for a field error, and no error means nothing to focus', () => {
    const many = { querySelectorAll: () => [{}, {}, {}, {}, {}], parentElement: null };
    const banner = { parentElement: many };
    assert.equal(firstInvalidIn({ querySelector: (selector) => (selector.includes('aria-invalid') ? null : banner) }), null);
    assert.equal(firstInvalidIn({ querySelector: () => null }), null);
  });

  it('is installed for every page, only listens to real submits, and the field components all mark errors with aria-invalid', () => {
    assert.match(read('src/app/layout.js'), /<FormSafety \/>/);
    const lib = read('src/lib/ui/focus-first-error.js');
    assert.match(lib, /doc\.addEventListener\('submit', onSubmit, true\)/);
    assert.doesNotMatch(lib, /addEventListener\('(click|input|blur|focusout)'/);
    assert.match(read('src/components/forms/Field.js'), /aria-invalid/);
  });
});

describe('leaving with unsaved work asks first (AC3)', () => {
  it('closing the tab or reloading asks while any open form says it has unsaved changes, and not otherwise', () => {
    const source = read('src/components/forms/FormSafety.js');
    assert.match(source, /window\.addEventListener\('beforeunload', onBeforeUnload\)/);
    assert.match(source, /if \(!isAnyDirty\(\)\) return;\s*event\.preventDefault\(\);\s*event\.returnValue = '';/);
    assert.match(source, /removeEventListener\('beforeunload', onBeforeUnload\)/);
  });

  it('uses the registry Sign out already uses: a registered form that is dirty is found, a clean or broken one is not a block', () => {
    const registry = createDirtyRegistry();
    assert.equal(registry.isAnyDirty(), false);
    let dirty = false;
    const stop = registry.register('start-transaction-page', () => dirty);
    assert.equal(registry.isAnyDirty(), false);
    dirty = true;
    assert.equal(registry.isAnyDirty(), true);
    stop();
    assert.equal(registry.isAnyDirty(), false);
    registry.register('broken', () => { throw new Error('x'); });
    assert.equal(registry.isAnyDirty(), false, 'a broken check never blocks leaving');
  });

  it('the Start transaction page (not only its modal) registers its unsaved work', () => {
    const form = read('src/components/transactions/StartTransactionForm.js');
    assert.match(form, /import \{ register as registerDirty \} from '..\/..\/lib\/ui\/dirty-registry\.js'/);
    assert.match(form, /if \(embedded\) return undefined;\s*return registerDirty\('start-transaction-page', \(\) => dirtyNow\.current\);/);
  });

  it('nothing is stored: the form text is not copied anywhere to keep it (the safe-recovery part waits for S8-33)', () => {
    assert.doesNotMatch(read('src/components/forms/FormSafety.js'), /localStorage|sessionStorage/);
  });
});

describe('long actions show progress (AC3)', () => {
  it('the submit buttons of the main forms are disabled and say what is happening while they run', () => {
    const start = read('src/components/transactions/StartTransactionForm.js');
    assert.match(start, /SubmitButton/);
    const submit = read('src/components/ui/SubmitButton.js');
    assert.match(submit, /loading=\{busy\} loadingLabel=\{busyLabel\}/, 'the submit button hands its busy state to the shared Button');
    const button = read('src/components/ui/Button.js');
    assert.match(button, /disabled=\{busy \|\| disabled\}/, 'which is disabled while the request runs');
    assert.match(button, /aria-busy=\{busy \|\| undefined\}/, 'and announces that it is busy');
  });
});
