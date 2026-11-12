// CC044 registry picker rules, CC047 client types per service, CC049 slip and the K16 disclosure line.
// Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { REGISTRY_SEARCH_API, searchRegistry } from '../../src/lib/api/registry.js';
import { ACK_QUOTE_LINE, acknowledgementSlip } from '../../src/lib/ui/acknowledgement.js';
import { seededHistoryDisclosure } from '../../src/lib/ui/seeded-history.js';
import { EMPTY_SERVICE_FORM, formToBody, toggleClientType, validateServiceForm } from '../../src/lib/ui/service-form.js';
import {
  EMPTY_REGISTRY,
  MESSAGES,
  allowedClientTypeOptions,
  isSearchable,
  registryBody,
  registryErrors,
  startErrorResult,
  startErrors,
} from '../../src/lib/ui/start-transaction.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { status, code, details });

describe('CC047 client types on the Start screen and the service form', () => {
  it('offers only the allowed types; a missing field means all four; a malformed one offers none', () => {
    assert.deepEqual(allowedClientTypeOptions({ allowed_client_types: ['ALUMNI', 'STUDENT'] }).map((t) => t.value), ['STUDENT', 'ALUMNI']);
    assert.equal(allowedClientTypeOptions({}).length, 4);
    assert.equal(allowedClientTypeOptions(null, { allowed_client_types: ['EXTERNAL'] }).length, 1);
    assert.deepEqual(allowedClientTypeOptions({ allowed_client_types: null }), []);
  });
  it('flags a type the service does not allow and maps the server refusal to the field', () => {
    const errors = startErrors({ form: { service_id: 's', client_type: 'EXTERNAL', client_reference: '', client_email: '', counter_id: '' }, standard: { allowed_client_types: ['STUDENT'] }, items: [{ id: 'x' }], checks: { x: true }, countersEnabled: false });
    assert.equal(errors.client_type, MESSAGES.clientTypeNotAllowed);
    assert.equal(startErrorResult(apiError(400, 'CLIENT_TYPE_NOT_ALLOWED')).fieldErrors.client_type, MESSAGES.clientTypeNotAllowed);
  });
  it('the service form requires at least one type, keeps the canonical order and sends it', () => {
    assert.deepEqual(toggleClientType(['STUDENT', 'EXTERNAL'], 'ALUMNI'), ['STUDENT', 'ALUMNI', 'EXTERNAL']);
    assert.deepEqual(toggleClientType(['STUDENT'], 'STUDENT'), []);
    assert.ok(validateServiceForm({ ...EMPTY_SERVICE_FORM, allowed_client_types: [] }, false).allowed_client_types);
    assert.deepEqual(formToBody({ ...EMPTY_SERVICE_FORM, allowed_client_types: ['EMPLOYEE'] }, false).allowed_client_types, ['EMPLOYEE']);
    assert.match(read('src/components/forms/ServiceForm.js'), /Who may avail[\s\S]*Client types that may start this service/);
  });
});

describe('CC044 registry choice', () => {
  it('searches only with three letters or a student number, through the gateway path', async () => {
    assert.equal(isSearchable('an'), false);
    assert.equal(isSearchable('ana'), true);
    assert.equal(isSearchable('2023-00001'), true);
    let url;
    await searchRegistry('ana cruz', 'ALUMNI', async (u) => { url = u; return { items: [] }; });
    assert.equal(url, `${REGISTRY_SEARCH_API}?q=ana+cruz&status=ALUMNI`);
    assert.equal(REGISTRY_SEARCH_API, '/api/operations/registry/search');
  });
  it('requires a choice and, for "Not in the registry" or an expired pick, a reason; OTHER needs a note', () => {
    assert.ok(registryErrors('STUDENT', EMPTY_REGISTRY).registry);
    assert.deepEqual(registryErrors('EMPLOYEE', EMPTY_REGISTRY), {});
    assert.deepEqual(registryErrors('STUDENT', { choice: 'match', record: { student_number: 'N1', is_expired: false }, reason: '', note: '' }), {});
    assert.ok(registryErrors('STUDENT', { choice: 'match', record: { student_number: 'N1', is_expired: true }, reason: '', note: '' }).registry_miss_reason);
    assert.ok(registryErrors('ALUMNI', { choice: 'not_found', record: null, reason: 'OTHER', note: ' ' }).registry_miss_note);
  });
  it('sends the picked number or the manual choice, never a registry status', () => {
    assert.deepEqual(registryBody('STUDENT', { choice: 'match', record: { student_number: 'N1', is_expired: false }, reason: '', note: '' }), { registry_student_number: 'N1' });
    assert.deepEqual(registryBody('ALUMNI', { choice: 'not_found', record: null, reason: 'OLDER_ALUMNI', note: '' }), { registry_not_found: true, registry_miss_reason: 'OLDER_ALUMNI' });
    assert.deepEqual(registryBody('EXTERNAL', { choice: 'not_found', record: null, reason: 'OTHER', note: 'x' }), {});
  });
  it('turns a server "reason required" answer into the reason field, and lets the manual path go on when lookup fails', () => {
    const r = startErrorResult(apiError(400, 'REGISTRY_REASON_REQUIRED', 'expired', { registry_miss_reason: 'This registry record has expired.', registry_status: 'EXPIRED' }));
    assert.equal(r.kind, 'registry_reason');
    assert.equal(r.registryStatus, 'EXPIRED');
    assert.equal(startErrorResult(apiError(503, 'REGISTRY_UNAVAILABLE', 'Choose "Not in the registry"')).kind, 'registry_unavailable');
  });
  it('the picker ignores out-of-order answers and clears on a new client type; the form clears on a new service', () => {
    const picker = read('src/components/transactions/RegistryPicker.js');
    assert.match(picker, /request === latest\.current/);
    assert.doesNotMatch(picker, /useEffect\(\(\) => \{\s*latest\.current \+= 1;\s*set/, 'no state reset inside an effect');
    const form = read('src/components/transactions/StartTransactionForm.js');
    assert.match(form, /<RegistryPicker key=\{`\$\{form\.service_id\}\|\$\{form\.client_type\}`\}/);
    assert.match(form, /client_type: '' \}\)\);\r?\n\s*setRegistry\(\{ \.\.\.EMPTY_REGISTRY \}\)/);
  });
});

describe('CC049 acknowledgement slip', () => {
  it('shows the six items from the saved transaction, with the exact quote line', () => {
    const slip = acknowledgementSlip({
      tracking_no: 'PUP-OSAS-20261112-0001', office_name: 'Student Affairs', office_code: 'PUP-OSAS', service_name: 'Transcript',
      started_by_name: 'Maria Officer', started_by_position: 'Administrative Aide III', started_at: '2026-11-12T01:30:00Z',
    });
    assert.equal(slip.trackingNo, 'PUP-OSAS-20261112-0001');
    assert.equal(slip.office, 'Student Affairs');
    assert.equal(slip.service, 'Transcript');
    assert.equal(slip.officerName, 'Maria Officer');
    assert.equal(slip.officerPosition, 'Administrative Aide III');
    assert.match(slip.receivedAt, /^11\/12\/2026 9:30 AM/);
    assert.equal(ACK_QUOTE_LINE, 'Quote this tracking number for any follow-up or complaint');
    assert.match(read('src/components/transactions/AcknowledgementSlip.js'), /\/pup-logo\.png/);
    assert.match(read('src/components/transactions/AcknowledgementSlip.js'), /window\.print\(\)/);
  });
});

describe('K16 disclosure line', () => {
  it('appears only with the configured period and go-live date', () => {
    assert.equal(seededHistoryDisclosure({ from: '2026-07-01', to: '2026-11-06', goLive: '2026-12-01' }),
      'Trained on simulated history from 07/01/2026 to 11/06/2026, made for testing. Data from 12/01/2026 on is live.');
    assert.equal(seededHistoryDisclosure({ from: '2026-07-01', to: '2026-11-06' }), null);
  });
});
