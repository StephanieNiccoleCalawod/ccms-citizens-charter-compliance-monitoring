import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CODE_TAKEN_MESSAGE,
  FORBIDDEN_MESSAGE,
  INSTITUTION_CODE_MESSAGE,
  INSTITUTION_IMMUTABLE_MESSAGE,
  INSTITUTION_NOT_CONFIGURED_MESSAGE,
  NAME_TAKEN_MESSAGE,
  OFFICE_PART_MESSAGE,
  SERVER_ERROR_MESSAGE,
  composeOfficeCode,
  hasPrefix,
  institutionCodeProblem,
  institutionSaveError,
  officeCodeProblem,
  officePart,
  officeRequestBody,
  officeSaveError,
} from '../../src/lib/ui/office-code.js';
import { CATALOGUE_SETTINGS_API } from '../../src/lib/api/catalogue.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });

describe('institution code format', () => {
  it('accepts 2 to 10 uppercase letters or digits', () => {
    for (const ok of ['PUP', 'PUPQC', 'AB', 'A1B2C3D4E5', 'P2']) assert.equal(institutionCodeProblem(ok), null, ok);
  });
  it('rejects everything else with the 2-10 uppercase letters or digits message', () => {
    for (const bad of ['', 'P', 'pup', 'PUP-QC', 'PUP QC', 'ABCDEFGHIJK', 'PÚP']) assert.equal(institutionCodeProblem(bad), INSTITUTION_CODE_MESSAGE, bad);
  });
});

describe('the office code is built from the institution code and the office part', () => {
  it('shows the full code as a preview: PUP + OSAS -> PUP-OSAS, PUP + REG -> PUP-REG', () => {
    assert.equal(composeOfficeCode('PUP', 'OSAS'), 'PUP-OSAS');
    assert.equal(composeOfficeCode('PUP', ' REG '), 'PUP-REG');
  });
  it('editing a prefixed code shows only the office part, so the institution code is never written twice', () => {
    assert.equal(officePart('PUP', 'PUP-OSAS'), 'OSAS');
    assert.equal(officePart('PUP', 'pup-admin'), 'admin');
    assert.equal(hasPrefix('PUP', 'PUP-ACAD'), true);
  });
  it('a saved code that does not start with the institution code has no separate part', () => {
    assert.equal(officePart('PUP', 'CAMP-ADMIN'), null);
    assert.equal(officePart('PUP', 'PUPX-ADMIN'), null);
  });
  it('sends the office part as office_abbr (upper-case), never office_code, because Core builds the code and rejects office_code', () => {
    assert.deepEqual(officeRequestBody(' osas ', 'Office of Student Services'), { office_abbr: 'OSAS', office_name: 'Office of Student Services' });
    assert.equal('office_code' in officeRequestBody('REG', 'Registrar'), false);
  });
});

describe('office code validation counts the whole code', () => {
  it('allows up to 20 characters counting the institution code and the hyphen', () => {
    assert.equal(officeCodeProblem('PUP', 'A'.repeat(16)), null); // PUP- + 16 = 20
    assert.match(officeCodeProblem('PUP', 'A'.repeat(17)), /21 characters/);
    assert.equal(officeCodeProblem('ABCDEFGHIJ', 'A'.repeat(9)), null); // 10 + 1 + 9 = 20
    assert.match(officeCodeProblem('ABCDEFGHIJ', 'A'.repeat(10)), /at most 9/);
  });
  it('needs an office part made only of letters and digits', () => {
    assert.match(officeCodeProblem('PUP', ''), /Enter the office part/);
    assert.match(officeCodeProblem('PUP', '   '), /Enter the office part/);
    for (const bad of ['OS AS', 'OSAS!', 'OS-AS', 'ÓSAS']) assert.equal(officeCodeProblem('PUP', bad), OFFICE_PART_MESSAGE, bad);
    for (const ok of ['osas', 'REG', 'A1']) assert.equal(officeCodeProblem('PUP', ok), null, ok);
  });
});

describe('what a failed office save says (Core\'s real answers)', () => {
  it('a duplicate code says exactly "Office code already exists", under the code field', () => {
    const r = officeSaveError(apiError(409, 'OFFICE_CODE_EXISTS', CODE_TAKEN_MESSAGE, { office_code: CODE_TAKEN_MESSAGE }), 'PUP');
    assert.deepEqual(r, { fieldErrors: { office_code: 'Office code already exists' }, message: null });
    assert.equal(CODE_TAKEN_MESSAGE, 'Office code already exists');
  });
  it('a duplicate name is reported under the name field', () => {
    const r = officeSaveError(apiError(409, 'OFFICE_NAME_EXISTS', 'x', { office_name: 'x' }), 'PUP');
    assert.deepEqual(r.fieldErrors, { office_name: NAME_TAKEN_MESSAGE });
  });
  it('a clash on both shows both messages', () => {
    const r = officeSaveError(apiError(409, 'OFFICE_CODE_EXISTS', 'x', { office_code: 'a', office_name: 'b' }), 'PUP');
    assert.deepEqual(r.fieldErrors, { office_code: CODE_TAKEN_MESSAGE, office_name: NAME_TAKEN_MESSAGE });
  });
  it('a code over 20 characters (Core names it office_abbr) explains the limit under the code field', () => {
    const r = officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { office_abbr: 'Office code must be 20 characters or fewer including the institution prefix' }), 'PUP');
    assert.match(r.fieldErrors.office_code, /at most 20 characters/);
    assert.match(r.fieldErrors.office_code, /at most 16/);
  });
  it('an invalid office part from Core is shown under the code field with Core\'s own words', () => {
    const r = officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { office_abbr: 'Office abbreviation must contain letters or digits' }), 'PUP');
    assert.deepEqual(r.fieldErrors, { office_code: 'Office abbreviation must contain letters or digits' });
  });
  it('a missing name is shown next to the name', () => {
    const r = officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { office_name: 'Office name is required' }), 'PUP');
    assert.deepEqual(r.fieldErrors, { office_name: 'Office name is required' });
  });
  it('an office with services whose code would change is explained, under the field and in the banner', () => {
    const r = officeSaveError(apiError(409, 'OFFICE_CODE_CHANGE_NEEDS_DECISION', 'Changing this office abbreviation would conflict with immutable service codes. A PM decision is required.', { office_abbr: 'This office has services with immutable codes' }), 'PUP');
    assert.equal(r.fieldErrors.office_code, 'This office has services with immutable codes');
    assert.match(r.message, /immutable service codes/);
  });
  it('no institution code yet says so, in the banner', () => {
    const r = officeSaveError(apiError(409, 'INSTITUTION_NOT_CONFIGURED', 'A Super Admin must initialize the institution code first'), null);
    assert.deepEqual(r, { fieldErrors: {}, message: INSTITUTION_NOT_CONFIGURED_MESSAGE });
  });
  it('403 gives a permission message with no server detail', () => {
    const r = officeSaveError(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js:1'), 'PUP');
    assert.equal(r.message, FORBIDDEN_MESSAGE);
    assert.doesNotMatch(r.message, /srv/);
  });
  it('a network failure and a server error give safe messages', () => {
    assert.equal(officeSaveError(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.'), 'PUP').message, 'Cannot reach the server. Check your connection and try again.');
    const r = officeSaveError(apiError(500, 'INTERNAL_ERROR', 'pg: relation offices does not exist'), 'PUP');
    assert.equal(r.message, SERVER_ERROR_MESSAGE);
    assert.doesNotMatch(r.message, /pg:/);
  });
});

describe('what a failed institution-code save says', () => {
  it('an invalid code explains the 2-10 uppercase letters or digits rule, under the field', () => {
    assert.deepEqual(institutionSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { institution_code: 'Institution code must be 2 to 10 uppercase letters or digits' })), { fieldErrors: { institution_code: INSTITUTION_CODE_MESSAGE }, message: null });
  });
  it('a change after setup is refused with the server\'s immutable answer, under the field', () => {
    assert.deepEqual(institutionSaveError(apiError(409, 'INSTITUTION_CODE_IMMUTABLE', 'x', { institution_code: 'The institution code cannot be changed' })), { fieldErrors: { institution_code: INSTITUTION_IMMUTABLE_MESSAGE }, message: null });
  });
  it('403, network and server failures give safe messages', () => {
    assert.equal(institutionSaveError(apiError(403, 'FORBIDDEN')).message, FORBIDDEN_MESSAGE);
    assert.equal(institutionSaveError(apiError(500, 'X', 'boom')).message, SERVER_ERROR_MESSAGE);
    assert.equal(institutionSaveError(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')).message, 'Cannot reach the server.');
  });
});

describe('the Offices page and the institution code panel (source checks, not a browser)', () => {
  const page = read('src/app/offices/page.js');
  const panel = read('src/components/offices/InstitutionCodePanel.js');
  const field = read('src/components/forms/OfficeCodeField.js');

  it('the settings endpoint is the one Core really has, reached through the gateway', () => {
    assert.equal(CATALOGUE_SETTINGS_API, '/api/catalogue/catalogue-settings');
  });
  it('the page is Super Admin only, reads the institution code from Core and keeps nothing in the browser', () => {
    assert.ok(page.includes('allowedRoles={[ROLES.SUPER_ADMIN]}'));
    assert.ok(page.includes('apiFetch(CATALOGUE_SETTINGS_API)'));
    assert.ok(!/localStorage|sessionStorage/.test(page + panel));
    assert.ok(!/['"]PUP['"]/.test(page.replace(/e\.g\.|for example/g, '')), 'PUP is not hardcoded as a value');
  });
  it('the code is saved with PUT { institution_code } only after a confirmation that says it cannot change', () => {
    assert.ok(panel.includes("apiFetch(CATALOGUE_SETTINGS_API, { method: 'PUT', body: { institution_code: value.trim() } })"));
    assert.ok(panel.includes('title="Set the institution code?"'));
    assert.ok(panel.includes('cannot be changed afterwards'));
    assert.equal([...panel.matchAll(/method: 'PUT'/g)].length, 1);
  });
  it('once the code is set the panel is gone (the code lives on as the fixed prefix of the office form), so there is nothing to edit', () => {
    assert.ok(panel.includes('if (settings.loading || settings.code) return null;'));
    assert.ok(!panel.includes('data-testid="institution-code"'), 'no read-only display of the code any more');
    assert.ok(!panel.includes('cannot be changed here'));
    assert.ok(page.includes('prefix={prefix}'), 'the code is the prefix in the office form');
    // the hooks all come before that early return
    assert.ok(panel.indexOf('useSingleSubmit()') < panel.indexOf('if (settings.loading || settings.code) return null;'));
  });
  it('an unavailable code is reported with a retry, and offices cannot be added or edited without it', () => {
    assert.ok(panel.includes('onClick={onRetry}'));
    assert.ok(page.includes('disabled={!prefix}'));
    assert.ok(page.includes("{ label: 'Edit', disabled: !prefix, onSelect: () => openForm(office) }"));
    assert.ok(page.includes('if (!prefix) return;'));
  });
  it('create and edit send office_abbr and office_name to the existing office endpoints, and keep what was typed on an error', () => {
    assert.ok(page.includes('officeRequestBody(form.office_code, form.office_name)'));
    assert.ok(page.includes("apiFetch(`${OFFICES_API}/${form.id}`, { method: 'PUT', body })"));
    assert.ok(page.includes("apiFetch(OFFICES_API, { method: 'POST', body })"));
    const catchBlock = page.slice(page.indexOf('} catch (err) {\n      // The service answers 409'), page.indexOf('async function setActive'));
    assert.ok(!catchBlock.includes('setForm(null)'), 'the form stays open with its values');
  });
  it('the full office codes from Core are shown in the table, as returned', () => {
    assert.ok(page.includes('<Th>Office code</Th>'));
    assert.ok(page.includes('{office.office_code}</td>'));
  });
  it('the form shows the institution code as fixed text joined to the office-part input, with a live full-code preview', () => {
    assert.ok(field.includes('data-testid="office-code-prefix"'));
    assert.ok(field.includes('rounded-l-md border border-r-0') && field.includes('rounded-l-none'));
    assert.ok(field.includes('data-testid="office-code-preview"'));
    assert.ok(field.includes('maxLength={maxLength}'));
    assert.ok(page.includes('prefix={prefix}'));
  });
});
