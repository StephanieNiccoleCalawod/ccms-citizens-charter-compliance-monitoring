import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  ABBR_MESSAGE,
  ABBR_REQUIRED_MESSAGE,
  EMPTY_SERVICE_FORM,
  PERMISSION_MESSAGE,
  PREVIEW_NO_OFFICE_MESSAGE,
  PREVIEW_UNAVAILABLE_MESSAGE,
  abbreviationProblem,
  formToBody,
  previewErrorMessage,
  previewPlan,
  serviceSaveError,
  serviceToForm,
  suggestAbbreviation,
  validateServiceForm,
} from '../../src/lib/ui/service-form.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const OFFICE = '3f2b9c1a-0d4e-4b7a-9c21-5e8f6a7b1c2d';

describe('abbreviation suggested from the service name', () => {
  it('the initials of the words', () => {
    assert.equal(suggestAbbreviation('Transcript of Records'), 'TOR');
    assert.equal(suggestAbbreviation('Certificate of Enrollment'), 'COE');
    assert.equal(suggestAbbreviation('Application for Graduation'), 'AFG');
    assert.equal(suggestAbbreviation('Student Information Update'), 'SIU');
  });
  it('more than five words give the first five initials; one word gives its first three letters; accents and symbols are ignored', () => {
    assert.equal(suggestAbbreviation('Application of General Clearance Request Form 2'), 'AOGCR');
    assert.equal(suggestAbbreviation('Clearance'), 'CLE');
    assert.equal(suggestAbbreviation('Résumé of Ñandú'), 'RON');
    assert.equal(suggestAbbreviation('Request / Release - Form'), 'RRF');
  });
  it('a name that gives nothing usable suggests nothing, and what it suggests is always a valid abbreviation', () => {
    for (const name of ['', '   ', '#', '-', 'A']) assert.equal(suggestAbbreviation(name), '', JSON.stringify(name));
    for (const name of ['Transcript of Records', 'Clearance', 'A B C D E F G', '12 Month Plan']) assert.equal(abbreviationProblem(suggestAbbreviation(name)), null, name);
  });
});

describe('abbreviation validation', () => {
  it('accepts 2 to 5 letters or digits, and lower case (it is turned into upper case)', () => {
    for (const ok of ['TOR', 'COE', 'AB', 'A1', 'ABCDE', 'tor', '12', '9A9']) assert.equal(abbreviationProblem(ok), null, ok);
  });
  it('refuses too short, too long, spaces and symbols, naming the abbreviation', () => {
    for (const bad of ['A', 'ABCDEF', 'TO R', 'TO-R', 'TO_R', 'T@R', 'T.R']) assert.equal(abbreviationProblem(bad), ABBR_MESSAGE, bad);
    assert.match(ABBR_MESSAGE, /^Service abbreviation/);
    assert.equal(abbreviationProblem(''), ABBR_REQUIRED_MESSAGE);
    assert.equal(abbreviationProblem('   '), ABBR_REQUIRED_MESSAGE);
  });
  it('the Add form reports it under the abbreviation field and only when adding', () => {
    const base = { ...EMPTY_SERVICE_FORM, office_id: OFFICE, service_name: 'Transcript of Records', transaction_types: ['G2C'], duration_days: '1', effective_from: '2026-11-01', charter_reference: 'p.1' };
    assert.equal(validateServiceForm({ ...base, service_abbr: 'T' }, true).service_abbr, ABBR_MESSAGE);
    assert.equal(validateServiceForm({ ...base, service_abbr: '' }, true).service_abbr, ABBR_REQUIRED_MESSAGE);
    assert.equal(validateServiceForm({ ...base, service_abbr: 'TOR' }, true).service_abbr, undefined);
    assert.equal(validateServiceForm({ ...base, service_abbr: '' }, false).service_abbr, undefined);
  });
});

describe('when the code preview is asked for', () => {
  it('not without an office, and not without a valid abbreviation: a message instead, no request', () => {
    assert.deepEqual(previewPlan('', 'TOR'), { state: 'no_office', message: PREVIEW_NO_OFFICE_MESSAGE });
    assert.equal(previewPlan(OFFICE, '').state, 'invalid');
    assert.equal(previewPlan(OFFICE, '').message, ABBR_REQUIRED_MESSAGE);
    assert.equal(previewPlan(OFFICE, 'T').message, ABBR_MESSAGE);
    assert.equal(previewPlan(OFFICE, 'TO R').state, 'invalid');
    assert.equal(previewPlan(OFFICE, 'ABCDEF').state, 'invalid');
  });
  it('with both, it asks Core\'s own endpoint with its own parameter names (officeId, abbr), with the abbreviation in upper case', () => {
    assert.deepEqual(previewPlan(OFFICE, ' tor '), { state: 'ready', path: `/services/next-code?officeId=${OFFICE}&abbr=TOR` });
  });
  it('a different office or abbreviation is a different request, so the newest one can be told apart from an older one', () => {
    assert.notEqual(previewPlan(OFFICE, 'TOR').path, previewPlan('11111111-1111-4111-8111-111111111111', 'TOR').path);
    assert.notEqual(previewPlan(OFFICE, 'TOR').path, previewPlan(OFFICE, 'COE').path);
  });
  it('a failed preview gives a message and never a code', () => {
    assert.equal(previewErrorMessage(apiError(403, 'FORBIDDEN')), PERMISSION_MESSAGE);
    assert.match(previewErrorMessage(apiError(404, 'OFFICE_NOT_FOUND')), /office could not be found/);
    assert.equal(previewErrorMessage(apiError(400, 'VALIDATION_ERROR', 'x', { service_abbr: 'Service abbreviation must be 2 to 5 uppercase letters or digits' })), 'Service abbreviation must be 2 to 5 uppercase letters or digits');
    assert.match(previewErrorMessage(apiError(409, 'SERVICE_CODE_EXHAUSTED', 'No three-digit service numbers remain for this office and abbreviation', { service_abbr: 'Choose a different abbreviation' })), /different abbreviation/);
    assert.equal(previewErrorMessage(apiError(500, 'INTERNAL_ERROR', 'pg: boom')), PREVIEW_UNAVAILABLE_MESSAGE);
    assert.equal(previewErrorMessage(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')), 'Cannot reach the server.');
    assert.doesNotMatch(previewErrorMessage(apiError(500, 'X', 'pg: boom')), /pg:/);
  });
});

describe('what is sent to save a service', () => {
  const form = { ...EMPTY_SERVICE_FORM, office_id: OFFICE, service_name: 'Transcript of Records', service_abbr: 'tor', transaction_types: ['G2C'], duration_days: '2', effective_from: '2026-11-01', charter_reference: 'p.1' };
  it('Add sends service_abbr in upper case and no service_code, no number and no preview', () => {
    const body = formToBody(form, true);
    assert.equal(body.service_abbr, 'TOR');
    for (const key of ['service_code', 'sequence', 'preview', 'service_number']) assert.equal(key in body, false, key);
  });
  it('Edit sends neither the code nor the abbreviation, so a rename can never change the code', () => {
    const edited = { ...serviceToForm({ service_id: 's', office_id: OFFICE, service_code: 'PUP-OSAS-TOR-001', service_name: 'Transcript', classification: 'SIMPLE', service_scope: 'EXTERNAL', transaction_types: ['G2C'], fees: null, who_may_avail: null, processing_steps: null }), service_name: 'Official Transcript' };
    const body = formToBody(edited, false);
    assert.equal(body.service_name, 'Official Transcript');
    assert.equal('service_code' in body, false);
    assert.equal('service_abbr' in body, false);
    assert.equal(edited.service_code, 'PUP-OSAS-TOR-001', 'the saved code is only shown');
  });
});

describe('what a failed save says', () => {
  it('403 (Office Head, Office Staff, Executive) is a permission message with no server detail', () => {
    assert.deepEqual(serviceSaveError(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js:1')), { details: {}, message: PERMISSION_MESSAGE });
  });
  it('Core\'s field errors are kept for the form, including a taken code (shown under the abbreviation) and an invalid abbreviation', () => {
    assert.deepEqual(serviceSaveError(apiError(409, 'SERVICE_CODE_EXISTS', 'Service code already exists', { service_code: 'Service code already exists' })).details, { service_code: 'Service code already exists' });
    assert.deepEqual(serviceSaveError(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { service_abbr: 'Service abbreviation must be 2 to 5 uppercase letters or digits' })).details, { service_abbr: 'Service abbreviation must be 2 to 5 uppercase letters or digits' });
  });
  it('an unknown office goes under the office field; network and server failures are safe', () => {
    assert.deepEqual(serviceSaveError(apiError(404, 'OFFICE_NOT_FOUND', 'Office not found or inactive')).details, { office_id: 'Office not found or inactive' });
    assert.equal(serviceSaveError(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')).message, 'Cannot reach the server.');
    assert.doesNotMatch(serviceSaveError(apiError(500, 'X', 'pg: boom')).message, /pg:/);
  });
});

describe('the Add and Edit forms and the pages (source checks, not a browser)', () => {
  const form = read('src/components/forms/ServiceForm.js');
  const list = read('src/app/services/page.js');
  const detail = read('src/app/services/[id]/page.js');

  it('there is no typed service code: the code is a read-only box, labelled "Generated service code" when adding', () => {
    assert.ok(!form.includes('name="service_code"') && !form.includes('data-field="service_code"'));
    assert.ok(form.includes("{isNew ? 'Generated service code' : 'Service code'}"));
    assert.ok(form.includes('data-testid="service-code"'));
    assert.ok(form.includes('className={`input-readonly'));
  });
  it('the name suggests the abbreviation until the person types one, which is marked Suggested and never overwritten', () => {
    assert.ok(form.includes('suggestAbbreviation(value)'));
    assert.ok(form.includes('if (isNew && !form.abbr_edited)'));
    assert.ok(form.includes('abbr_edited: value.trim() !== \'\''));
    assert.ok(form.includes('data-testid="abbr-suggested"'));
    assert.ok(form.indexOf('htmlFor={`${id}-service_name`}') < form.indexOf('htmlFor={`${id}-service_abbr`}'), 'the name comes before the abbreviation');
  });
  it('the abbreviation shows its message as soon as it is wrong and no longer drops characters silently', () => {
    assert.ok(form.includes('abbreviationProblem(form.service_abbr)'));
    assert.ok(!form.includes(".replace(/[^A-Z0-9]/g, '')"));
  });
  it('the preview asks Core only for a ready plan, ignores an answer for an older choice, and never builds a code itself', () => {
    assert.ok(form.includes('previewPlan(officeId, abbreviation)'));
    assert.ok(form.includes('let current = true;') && form.includes('current && setResult'));
    assert.ok(form.includes('current = false;'));
    assert.ok(form.includes('apiFetch(`${CATALOGUE_API}${key}`)'));
    assert.ok(!/`\$\{[^`]*office_code[^`]*\}-\$\{/.test(form), 'no string built from an office code');
    assert.ok(!/\bpadStart\(3/.test(form), 'no number built here');
  });
  it('the five preview states are shown: no office, invalid abbreviation, loading, the exact code from Core, and an error message', () => {
    for (const token of ["preview.state === 'ready'", "preview.state === 'loading'", 'preview.message', 'Checking the next code…', 'data-state={isNew ? preview.state']) assert.ok(form.includes(token), token);
  });
  it('editing never asks for a preview, and a clash on save asks for a fresh one', () => {
    assert.ok(form.includes('useCodePreview(isNew,'));
    assert.ok(form.includes('const plan = enabled ? previewPlan('));
    assert.ok(form.includes('apiErrors.fields.service_abbr ? errors : null'));
  });
  it('after a save the message carries the code Core returned, errors use the safe mapping, and nothing is shown as saved on an error', () => {
    assert.ok(list.includes("`${savedMessage('Service', 'created')} Its code is ${data.service.service_code}.`"));
    assert.ok(list.includes('serviceSaveError(err)'));
    assert.ok(detail.includes('serviceSaveError(err)'));
    const catchAt = list.indexOf('const { details, message } = serviceSaveError(err);');
    assert.ok(!list.slice(catchAt - 200, catchAt + 400).includes('notify.success'));
  });
  it('only the Super Admin gets Add and Edit', () => {
    assert.ok(list.includes('{isAdmin ? ('));
    assert.ok(list.includes("{ label: 'Edit', onSelect: () => openForm(s) }"));
  });
  it('the code is shown as returned in the list and the details, never rebuilt', () => {
    assert.ok(list.includes('${s.office_name} · ${s.service_code}'));
    assert.ok(detail.includes('{service.service_code}'));
  });
});
