import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { COUNTERS_API, SETTINGS_API, countersUrl, createCounter, deactivateCounter, listCounters, putSettings, reactivateCounter, updateCounter } from '../../src/lib/api/operations.js';
import {
  AUTO_CLOSE_FIELDS,
  AUTO_CLOSE_RULE,
  DEFAULT_SETTINGS,
  LABEL_TAKEN_MESSAGE,
  SETTINGS_CONFLICT_MESSAGE,
  canChangeTransactionSettings,
  counterLabelProblem,
  parseAutoCloseDays,
  prepareSettingsSave,
  sameForm,
  saveCounter,
  saveSettings,
  settingsToForm,
  showCounters,
} from '../../src/lib/ui/transaction-settings.js';

// An error the way the API client throws it (ApiError: message, status, code, details).
const apiError = (status, code, message = 'x', details) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const OFFICE = '11111111-1111-4111-8111-111111111111';

describe('settings values and defaults', () => {
  it('starts with Hold off, Counters off and all three auto-close values off (null)', () => {
    assert.equal(DEFAULT_SETTINGS.hold_enabled, false);
    assert.equal(DEFAULT_SETTINGS.counters_enabled, false);
    for (const { key } of AUTO_CLOSE_FIELDS) assert.equal(DEFAULT_SETTINGS[key], null);
    assert.deepEqual(settingsToForm(DEFAULT_SETTINGS), { hold_enabled: false, counters_enabled: false, auto_close_days_simple: '', auto_close_days_complex: '', auto_close_days_highly_technical: '' });
  });

  it('shows the server values in the form, with null as an empty box', () => {
    const form = settingsToForm({ hold_enabled: true, counters_enabled: false, auto_close_days_simple: 5, auto_close_days_complex: null, auto_close_days_highly_technical: 30, version: 4 });
    assert.deepEqual(form, { hold_enabled: true, counters_enabled: false, auto_close_days_simple: '5', auto_close_days_complex: '', auto_close_days_highly_technical: '30' });
    assert.equal(sameForm(form, settingsToForm({ hold_enabled: true, counters_enabled: false, auto_close_days_simple: 5, auto_close_days_complex: null, auto_close_days_highly_technical: 30 })), true);
    assert.equal(sameForm(form, { ...form, auto_close_days_complex: '1' }), false);
    assert.equal(sameForm(form, { ...form, hold_enabled: false }), false);
  });
});

describe('auto-close validation', () => {
  it('an empty field is null (off), never zero', () => {
    for (const empty of ['', '   ', null, undefined]) assert.deepEqual(parseAutoCloseDays(empty), { value: null });
  });

  it('accepts whole numbers from 1 to 365', () => {
    for (const [text, value] of [['1', 1], ['30', 30], [' 45 ', 45], ['365', 365], ['007', 7]]) assert.deepEqual(parseAutoCloseDays(text), { value });
  });

  it('rejects zero, negatives, decimals, non-numbers and anything above 365', () => {
    for (const bad of ['0', '-1', '-0', '1.5', '2.0', '1,5', 'abc', '12abc', '1e2', '+5', '366', '1000', '0x10', 'Infinity', 'NaN']) {
      assert.deepEqual(parseAutoCloseDays(bad), { error: AUTO_CLOSE_RULE }, bad);
    }
  });

  it('names the invalid field and sends nothing', () => {
    const form = { ...settingsToForm(DEFAULT_SETTINGS), auto_close_days_simple: '0', auto_close_days_complex: '12', auto_close_days_highly_technical: '400' };
    const result = prepareSettingsSave(form, 3);
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.fieldErrors).sort(), ['auto_close_days_highly_technical', 'auto_close_days_simple']);
    assert.match(result.fieldErrors.auto_close_days_simple, /^Auto-Close Simple: /);
    assert.match(result.fieldErrors.auto_close_days_highly_technical, /^Auto-Close Highly Technical: /);
  });
});

describe('saving settings', () => {
  const form = { hold_enabled: true, counters_enabled: true, auto_close_days_simple: '10', auto_close_days_complex: '', auto_close_days_highly_technical: '90' };

  it('sends the full settings with the version that was read, empty fields as null', async () => {
    let sent;
    const saved = { hold_enabled: true, counters_enabled: true, auto_close_days_simple: 10, auto_close_days_complex: null, auto_close_days_highly_technical: 90, version: 8 };
    const result = await saveSettings({ form, version: 7, put: async (body) => ((sent = body), saved) });
    assert.deepEqual(sent, { hold_enabled: true, counters_enabled: true, auto_close_days_simple: 10, auto_close_days_complex: null, auto_close_days_highly_technical: 90, version: 7 });
    assert.equal(sent.auto_close_days_complex, null);
    assert.deepEqual(result, { ok: true, settings: saved });
  });

  it('PUT /settings goes to the Operations API through the gateway with that body', async () => {
    let call;
    await putSettings({ version: 2 }, async (path, init) => ((call = { path, init }), {}));
    assert.deepEqual(call, { path: '/api/operations/settings', init: { method: 'PUT', body: { version: 2 } } });
    assert.equal(SETTINGS_API, '/api/operations/settings');
  });

  it('HTTP 409 gives the exact conflict message and reports nothing saved', async () => {
    const result = await saveSettings({ form, version: 7, put: async () => { throw apiError(409, 'SETTINGS_VERSION_CONFLICT', 'something else'); } });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'conflict');
    assert.equal(result.message, 'Settings were changed by someone else. Reload and try again.');
    assert.equal(result.message, SETTINGS_CONFLICT_MESSAGE);
  });

  it('does not send an invalid form or a form with no version', async () => {
    let calls = 0;
    const put = async () => (calls += 1);
    assert.equal((await saveSettings({ form: { ...form, auto_close_days_simple: '0' }, version: 7, put })).kind, 'invalid');
    assert.equal((await saveSettings({ form, version: null, put })).kind, 'invalid');
    assert.equal(calls, 0);
  });

  it('maps 403, the server\'s 400 and other failures without throwing', async () => {
    assert.equal((await saveSettings({ form, version: 1, put: async () => { throw apiError(403, 'FORBIDDEN'); } })).kind, 'forbidden');
    const invalid = await saveSettings({ form, version: 1, put: async () => { throw apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { auto_close_days_simple: 'bad' }); } });
    assert.equal(invalid.kind, 'invalid');
    assert.match(invalid.fieldErrors.auto_close_days_simple, /^Auto-Close Simple: /);
    const failed = await saveSettings({ form, version: 1, put: async () => { throw apiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'); } });
    assert.deepEqual([failed.ok, failed.kind, failed.message], [false, 'error', 'Something went wrong. Please try again.']);
  });
});

describe('who sees what', () => {
  it('only Super Admin can change settings; every role can read them', () => {
    assert.equal(canChangeTransactionSettings(ROLES.SUPER_ADMIN), true);
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE, undefined, 'admin']) assert.equal(canChangeTransactionSettings(role), false, String(role));
  });

  it('Counters show only while Counters Enabled is on, and never for Executive', () => {
    const on = { counters_enabled: true };
    const off = { counters_enabled: false };
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      assert.equal(showCounters(on, role), true, role);
      assert.equal(showCounters(off, role), false, role);
    }
    assert.equal(showCounters(on, ROLES.EXECUTIVE), false);
    assert.equal(showCounters(null, ROLES.SUPER_ADMIN), false);
    assert.equal(showCounters({}, ROLES.SUPER_ADMIN), false);
  });
});

describe('counters API calls', () => {
  it('lists counters by office, or all when no office is given', async () => {
    const paths = [];
    const fetcher = async (path) => (paths.push(path), { items: [] });
    await listCounters(OFFICE, fetcher);
    await listCounters('', fetcher);
    assert.deepEqual(paths, [`/api/operations/counters?officeId=${OFFICE}`, '/api/operations/counters']);
    assert.equal(countersUrl('a b'), `${COUNTERS_API}?officeId=a%20b`);
  });

  it('creates with POST, edits with PUT, deactivates and reactivates with PATCH', async () => {
    const calls = [];
    const fetcher = async (path, init) => (calls.push([path, init]), {});
    await createCounter({ office_id: OFFICE, label: 'Window 1' }, fetcher);
    await updateCounter('c1', { office_id: OFFICE, label: 'Window 2' }, fetcher);
    await deactivateCounter('c1', fetcher);
    await reactivateCounter('c1', fetcher);
    assert.deepEqual(calls, [
      ['/api/operations/counters', { method: 'POST', body: { office_id: OFFICE, label: 'Window 1' } }],
      ['/api/operations/counters/c1', { method: 'PUT', body: { office_id: OFFICE, label: 'Window 2' } }],
      ['/api/operations/counters/c1/deactivate', { method: 'PATCH' }],
      ['/api/operations/counters/c1/reactivate', { method: 'PATCH' }],
    ]);
  });
});

describe('saving a counter', () => {
  it('creates a counter with the trimmed label', async () => {
    let sent;
    const created = { counter_id: 'c1', office_id: OFFICE, label: 'Window 1', is_active: true };
    const result = await saveCounter({ office_id: OFFICE, label: '  Window 1  ' }, { create: async (body) => ((sent = body), created) });
    assert.deepEqual(sent, { office_id: OFFICE, label: 'Window 1' });
    assert.deepEqual(result, { ok: true, counter: created });
  });

  it('edits an existing counter (id present) instead of creating', async () => {
    const calls = [];
    const result = await saveCounter({ id: 'c1', office_id: OFFICE, label: 'Window 9' }, {
      create: async () => calls.push('create'),
      update: async (id, body) => (calls.push(['update', id, body]), { counter_id: id, ...body, is_active: true }),
    });
    assert.deepEqual(calls, [['update', 'c1', { office_id: OFFICE, label: 'Window 9' }]]);
    assert.equal(result.ok, true);
  });

  it('refuses an empty or over-long label without calling the service', async () => {
    let calls = 0;
    const create = async () => (calls += 1);
    for (const label of ['', '   ', 'x'.repeat(51)]) {
      const result = await saveCounter({ office_id: OFFICE, label }, { create });
      assert.equal(result.ok, false);
      assert.ok(result.fieldErrors.label, label);
    }
    assert.equal(counterLabelProblem('x'.repeat(50)), null);
    assert.equal(calls, 0);
  });

  it('explains a duplicate label (the service decides, in any letter case) next to the label field', async () => {
    const result = await saveCounter({ office_id: OFFICE, label: 'window 1' }, { create: async () => { throw apiError(409, 'COUNTER_LABEL_EXISTS', 'This office already has a counter with this label', { label: 'x' }); } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.fieldErrors, { label: LABEL_TAKEN_MESSAGE });
    assert.match(LABEL_TAKEN_MESSAGE, /not case-sensitive/);
  });

  it('turns the other failures into plain messages and never throws', async () => {
    const failWith = (err) => saveCounter({ office_id: OFFICE, label: 'A' }, { create: async () => { throw err; } });
    assert.match((await failWith(apiError(409, 'COUNTER_HAS_OPEN_TRANSACTION'))).message, /open transaction/);
    assert.match((await failWith(apiError(409, 'OFFICE_INACTIVE'))).message, /not active/);
    assert.match((await failWith(apiError(403, 'FORBIDDEN'))).message, /permission/);
    assert.match((await failWith(apiError(503, 'CATALOGUE_UNAVAILABLE', 'raw'))).message, /not available/);
    assert.deepEqual((await failWith(apiError(400, 'VALIDATION_ERROR', 'Please correct', { label: 'Counter label is required' }))).fieldErrors, { label: 'Counter label is required' });
    assert.equal((await failWith(apiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'))).message, 'Something went wrong. Please try again.');
  });
});
