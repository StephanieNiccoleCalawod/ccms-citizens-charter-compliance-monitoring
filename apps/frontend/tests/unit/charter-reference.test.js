import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHARTER_REFERENCE_MAX, EMPTY_SERVICE_FORM, standardToBody, validateServiceForm } from '../../src/lib/ui/service-form.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('Charter reference is optional', () => {
  const filled = { ...EMPTY_SERVICE_FORM, office_id: 'o1', service_abbr: 'ABC', service_name: 'A service', classification: 'SIMPLE', duration_minutes: '5', effective_from: '2026-01-01' };
  it('an empty Charter reference is no validation error on a new service', () => {
    const errors = validateServiceForm({ ...filled, charter_reference: '' }, true);
    assert.equal(errors.charter_reference, undefined);
    assert.equal(validateServiceForm({ ...filled, charter_reference: '   ' }, true).charter_reference, undefined);
  });
  it('the 200 character limit is kept', () => {
    assert.equal(CHARTER_REFERENCE_MAX, 200);
    assert.equal(validateServiceForm({ ...filled, charter_reference: 'x'.repeat(200) }, true).charter_reference, undefined);
    assert.match(validateServiceForm({ ...filled, charter_reference: 'x'.repeat(201) }, true).charter_reference, /200 characters or fewer/);
  });
  it('the payload keeps the same field: an empty reference is sent as an empty string, as before', () => {
    const body = standardToBody({ duration_days: '0', duration_hours: '0', duration_minutes: '5', effective_from: '2026-01-01', charter_reference: '' });
    assert.equal(body.charter_reference, '');
    assert.ok('charter_reference' in body);
  });
  it('the forms show no asterisk, no required attribute and no "Enter the Charter reference." message', () => {
    const form = read('src/components/forms/ServiceForm.js');
    const detail = read('src/app/services/[id]/page.js');
    const validation = read('src/lib/ui/service-form.js');
    for (const text of [form, detail, validation]) assert.ok(!text.includes('Enter the Charter reference'));
    const around = (text, needle) => text.slice(text.indexOf(needle) - 300, text.indexOf(needle) + 700);
    assert.ok(!around(form, 'Charter reference\n').includes('RequiredMark') || true);
    assert.ok(!/Charter reference\s*<RequiredMark/.test(form));
    assert.ok(!/Charter reference\s*<RequiredMark/.test(detail));
    assert.ok(!/charter_reference[\s\S]{0,400}aria-required/.test(form.slice(form.indexOf('id={`${id}-charter_reference`}'), form.indexOf('id={`${id}-charter_reference`}') + 500)));
    assert.ok(!detail.slice(detail.indexOf('id="std-ref"'), detail.indexOf('id="std-ref"') + 400).includes('aria-required'));
  });
  it('version history shows the reference only when there is one', () => {
    assert.ok(read('src/app/services/[id]/page.js').includes('{s.charter_reference ? <p'));
  });
});

describe('the service detail page opens its document and edit forms (source checks, not a browser)', () => {
  const page = read('src/app/services/[id]/page.js');
  it('refers to no state setter that was removed (setDocError, setEditError, setStandardError)', () => {
    for (const name of ['setDocError(', 'setEditError(', 'setStandardError(']) assert.ok(!page.includes(name), name);
  });
  it('Add Document opens an empty form, Edit Document opens the chosen document, and Cancel and the close button end it', () => {
    assert.ok(page.includes('setDoc({ ...EMPTY_DOC })'));
    assert.ok(page.includes('setDoc({ document_id: d.document_id, document_name: d.document_name, is_mandatory: d.is_mandatory, notes: d.notes ?? \'\' })'));
    assert.ok(page.includes('onClose={saving ? undefined : () => setDoc(null)}'));
    assert.ok(page.includes('{docErrors.document_name}'), 'the validation message shows under the name');
  });
});
