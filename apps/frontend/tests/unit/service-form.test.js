import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { STANDARD_WARNING_DAYS, scopeLabel, standardText, standardWarning, transactionTypesText } from '../../src/lib/api/catalogue.js';
import {
  EMPTY_SERVICE_FORM,
  SERVICE_FORM_FIELDS,
  durationErrors,
  formToBody,
  mapServiceErrors,
  serviceToForm,
  validateServiceForm,
} from '../../src/lib/ui/service-form.js';

const OFFICE = '3f2b9c1a-0d4e-4b7a-9c21-5e8f6a7b1c2d';
const valid = () => ({
  ...EMPTY_SERVICE_FORM,
  office_id: OFFICE,
  service_abbr: 'tor',
  service_name: 'Transcript of Records',
  service_scope: 'EXTERNAL',
  transaction_types: ['G2C', 'G2B'],
  duration_days: '2',
  duration_hours: '4',
  duration_minutes: '30',
  effective_from: '2026-11-01',
  charter_reference: 'Charter p. 12',
});

describe('create request matches the Core contract', () => {
  it('sends service_abbr, scope, a list of transaction types and the three duration parts, and never a service_code', () => {
    const body = formToBody(valid(), true);
    assert.equal(body.service_abbr, 'TOR');
    assert.equal(body.service_scope, 'EXTERNAL');
    assert.deepEqual(body.transaction_types, ['G2C', 'G2B']);
    assert.deepEqual(body.standard, { duration_days: 2, duration_hours: 4, duration_minutes: 30, effective_from: '2026-11-01', charter_reference: 'Charter p. 12' });
    assert.equal('service_code' in body, false);
    assert.equal('transaction_type' in body, false);
    assert.equal('duration_unit' in body.standard, false);
  });
  it('each duration part is independent', () => {
    const body = formToBody({ ...valid(), duration_days: '0', duration_hours: '0', duration_minutes: '15' }, true);
    assert.deepEqual([body.standard.duration_days, body.standard.duration_hours, body.standard.duration_minutes], [0, 0, 15]);
  });
});

describe('edit request', () => {
  const saved = {
    service_id: 's1',
    office_id: OFFICE,
    service_code: 'REG-TOR-001',
    service_name: 'Transcript',
    classification: 'COMPLEX',
    service_scope: 'INTERNAL',
    transaction_types: ['G2G'],
    processing_steps: null,
    fees: 'PHP 100',
    who_may_avail: 'Line one\n\nLine three',
  };
  it('starts from every stored value, so saving without changes sends the same data', () => {
    assert.deepEqual(formToBody(serviceToForm(saved), false), {
      office_id: OFFICE,
      service_name: 'Transcript',
      classification: 'COMPLEX',
      service_scope: 'INTERNAL',
      transaction_types: ['G2G'],
      processing_steps: null,
      fees: 'PHP 100',
      who_may_avail: 'Line one\n\nLine three',
    });
  });
  it('never sends the service code or the abbreviation, so a moved service keeps its code', () => {
    const form = { ...serviceToForm(saved), office_id: '11111111-1111-4111-8111-111111111111' };
    const body = formToBody(form, false);
    assert.equal('service_code' in body, false);
    assert.equal('service_abbr' in body, false);
    assert.equal('standard' in body, false);
    assert.equal(form.service_code, 'REG-TOR-001'); // shown read-only
  });
  it('who may avail keeps its line breaks exactly; blank becomes null', () => {
    assert.equal(formToBody({ ...serviceToForm(saved), who_may_avail: 'a\nb\n\nc' }, false).who_may_avail, 'a\nb\n\nc');
    assert.equal(formToBody({ ...serviceToForm(saved), who_may_avail: '  \n ' }, false).who_may_avail, null);
  });
});

describe('validation', () => {
  it('a complete form has no errors', () => {
    assert.deepEqual(validateServiceForm(valid(), true), {});
  });
  it('flags only the fields that fail, each with its own message', () => {
    const errors = validateServiceForm({ ...valid(), office_id: '', service_abbr: 'A', service_name: 'ab', transaction_types: [], charter_reference: ' ' }, true);
    assert.deepEqual(Object.keys(errors).sort(), ['office_id', 'service_abbr', 'service_name', 'transaction_types']);
    assert.match(errors.transaction_types, /at least one/i);
  });
  it('the abbreviation and standard are only checked when adding', () => {
    assert.deepEqual(validateServiceForm({ ...valid(), service_abbr: '', duration_days: '', charter_reference: '' }, false), {});
  });
  it('who may avail allows 1,000 characters and not 1,001', () => {
    assert.equal(validateServiceForm({ ...valid(), who_may_avail: 'x'.repeat(1000) }, true).who_may_avail, undefined);
    assert.match(validateServiceForm({ ...valid(), who_may_avail: 'x'.repeat(1001) }, true).who_may_avail, /1000/);
  });
  it('the three duration parts are whole numbers and at least one is above zero', () => {
    assert.deepEqual(Object.keys(durationErrors({ duration_days: '0', duration_hours: '0', duration_minutes: '0' })), ['duration']);
    assert.deepEqual(Object.keys(durationErrors({ duration_days: '1.5', duration_hours: '-1', duration_minutes: '' })), ['duration_days', 'duration_hours', 'duration_minutes']);
    assert.deepEqual(durationErrors({ duration_days: '0', duration_hours: '0', duration_minutes: '1' }), {});
    // hours stay within a day and minutes within an hour; the parts are never converted
    assert.deepEqual(Object.keys(durationErrors({ duration_days: '10', duration_hours: '0', duration_minutes: '1000' })), ['duration_minutes']);
    assert.deepEqual(Object.keys(durationErrors({ duration_days: '10', duration_hours: '24', duration_minutes: '60' })), ['duration_hours', 'duration_minutes']);
    assert.deepEqual(durationErrors({ duration_days: '10', duration_hours: '23', duration_minutes: '59' }), {});
  });
});

describe('the service field errors land on the matching fields', () => {
  it('maps "standard." keys and keeps unknown ones as general messages', () => {
    const { fields, other } = mapServiceErrors(
      {
        'standard.duration_days': 'bad days',
        'standard.duration': 'one part',
        service_abbr: 'taken',
        service_code: 'Service code already exists',
        service_name: 'This office already has a service with this name',
      },
      SERVICE_FORM_FIELDS,
    );
    assert.deepEqual(fields, { duration_days: 'bad days', duration: 'one part', service_abbr: 'taken', service_name: 'This office already has a service with this name' });
    assert.deepEqual(other, ['Service code already exists']);
  });
  it('a duplicate code answer lands on the abbreviation when adding, and stays general when editing', () => {
    const details = { service_code: 'Service code already exists' };
    assert.deepEqual(mapServiceErrors(details, SERVICE_FORM_FIELDS, { isNew: true }), { fields: { service_abbr: 'Service code already exists' }, other: [] });
    assert.deepEqual(mapServiceErrors(details, SERVICE_FORM_FIELDS, { isNew: false }), { fields: {}, other: ['Service code already exists'] });
    assert.deepEqual(mapServiceErrors({ standard: 'First standard is required' }, SERVICE_FORM_FIELDS, { isNew: true }).other, ['First standard is required']);
  });
});

describe('processing standard warning (FE-06)', () => {
  it('thresholds are 3, 7 and 20 working days', () => {
    assert.deepEqual(STANDARD_WARNING_DAYS, { SIMPLE: 3, COMPLEX: 7, HIGHLY_TECHNICAL: 20 });
  });
  it('no warning at or under the limit', () => {
    assert.equal(standardWarning('SIMPLE', 3, 0, 0), null);
    assert.equal(standardWarning('SIMPLE', 0, 5, 0), null);
    assert.equal(standardWarning('COMPLEX', 7, 0, 0), null);
    assert.equal(standardWarning('HIGHLY_TECHNICAL', 20, 0, 0), null);
  });
  it('the reviewed examples: the limit alone is fine, one more hour or minute warns', () => {
    assert.equal(standardWarning('SIMPLE', 3, 0, 0), null);
    assert.ok(standardWarning('SIMPLE', 3, 1, 0));
    assert.equal(standardWarning('COMPLEX', 7, 0, 0), null);
    assert.ok(standardWarning('COMPLEX', 7, 0, 1));
    assert.equal(standardWarning('HIGHLY_TECHNICAL', 20, 0, 0), null);
    assert.ok(standardWarning('HIGHLY_TECHNICAL', 20, 0, 1));
    // days are never converted: 2 days and 23 hours is still under the 3-day limit
    assert.equal(standardWarning('SIMPLE', 2, 23, 59), null);
    // text from number inputs works the same
    assert.ok(standardWarning('SIMPLE', '3', '0', '1'));
    assert.equal(standardWarning('SIMPLE', '', '', ''), null);
  });
  it('warns above the limit, including the limit plus hours or minutes', () => {
    assert.match(standardWarning('SIMPLE', 4, 0, 0), /3 working days/);
    assert.match(standardWarning('SIMPLE', 3, 0, 1), /Simple/);
    assert.match(standardWarning('COMPLEX', '8', '0', '0'), /7 working days/);
    assert.match(standardWarning('HIGHLY_TECHNICAL', 21, 0, 0), /Highly Technical/);
  });
  it('the warning says saving is still possible', () => {
    assert.match(standardWarning('SIMPLE', 10, 0, 0), /can still save/);
  });
  it('an unknown type gives no warning', () => {
    assert.equal(standardWarning('OTHER', 99, 0, 0), null);
  });
});

describe('standard and service wording', () => {
  it('writes the three parts, leaving out zero parts', () => {
    assert.equal(standardText(2, 5, 30), '2 working days, 5 hours, 30 minutes');
    assert.equal(standardText(1, 0, 0), '1 working day');
    assert.equal(standardText(0, 0, 7), '7 minutes');
  });
  it('scope and transaction types', () => {
    assert.equal(scopeLabel('INTERNAL'), 'Internal');
    assert.equal(transactionTypesText(['G2C', 'G2B']), 'G2C, G2B');
    assert.equal(transactionTypesText(null), '');
  });
});

describe('Required documents on the Add Service form (Defect 12)', () => {
  it('sends the documents with a new service, and none with an edit', async () => {
    const { formToBody, EMPTY_SERVICE_FORM } = await import('../../src/lib/ui/service-form.js');
    const form = { ...EMPTY_SERVICE_FORM, office_id: 'o', service_name: 'Transcript', service_abbr: 'tor', transaction_types: ['G2C'], duration_days: '1', effective_from: '2026-11-01',
      documents: [{ document_name: 'Valid ID', is_mandatory: true, notes: '' }, { document_name: 'Application form', is_mandatory: false, notes: 'Two copies' }] };
    assert.deepEqual(formToBody(form, true).documents, [
      { document_name: 'Valid ID', is_mandatory: true, notes: null },
      { document_name: 'Application form', is_mandatory: false, notes: 'Two copies' },
    ]);
    assert.equal('documents' in formToBody(form, false), false);
    assert.deepEqual(formToBody({ ...form, documents: [] }, true).documents, []);
  });
  it('checks the rows before sending: name needed, no duplicates, row number in the message', async () => {
    const { documentsProblem, mapServiceErrors, SERVICE_FORM_FIELDS } = await import('../../src/lib/ui/service-form.js');
    assert.equal(documentsProblem([]), null);
    assert.match(documentsProblem([{ document_name: ' ', notes: '' }]), /^Document 1: enter the document name/);
    assert.match(documentsProblem([{ document_name: 'Valid ID' }, { document_name: '  valid   id ' }]), /^Document 2: .*already has a document with this name/);
    assert.equal(documentsProblem([{ document_name: 'Valid ID', notes: 'x'.repeat(1000) }]), null);
    const mapped = mapServiceErrors({ 'documents.1.document_name': 'Document name is required' }, SERVICE_FORM_FIELDS, { isNew: true });
    assert.deepEqual(mapped.fields, { documents: 'Document 2: Document name is required' });
  });
});
