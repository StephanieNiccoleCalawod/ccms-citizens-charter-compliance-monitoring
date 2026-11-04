import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { auditEntityName, validIncomingAuditName } from '../src/audit-name.js';
describe('F7 safe administrative audit names', () => {
  it('uses only known administrative fields and snapshots', () => {
    assert.equal(auditEntityName({ entityType: 'Service', after: { service_name: 'Transcript of Records' } }), 'Transcript of Records');
    assert.equal(auditEntityName({ entityType: 'office', before: { office_name: 'Registrar' } }), 'Registrar');
    assert.equal(auditEntityName({ entityType: 'account', after: { full_name: 'Staff Test Person' } }), 'Staff Test Person');
    assert.equal(auditEntityName({ entityType: 'RequiredDocument', after: { document_name: 'Application form' } }), 'Application form');
  });
  it('never uses citizen names, contact information, references or arbitrary payload names', () => {
    for (const entityType of ['transaction', 'citizen', 'student', 'registry']) assert.equal(auditEntityName({ entityType, entityName: 'Citizen Test Person', after: { full_name: 'Citizen Test Person', client_email: 'test@example.test', client_reference: '2026-001' } }), null);
    assert.equal(auditEntityName({ entityType: 'transaction', entityName: 'Citizen Test Person', after: { tracking_no: 'PUP-OSAS-20261110-0001' } }), 'PUP-OSAS-20261110-0001');
    for (const name of ['a'.repeat(301), 'Line\nbreak', 'test@example.test', '', 'Citizen Test Person']) assert.equal(validIncomingAuditName('transaction', name), false);
    assert.equal(validIncomingAuditName('office', 'test@example.test'), false);
  });
  it('accepts old events without a name and validates bounded new fields', () => {
    assert.equal(validIncomingAuditName('unknown_old_entity', undefined), true);
    assert.equal(validIncomingAuditName('office', 'A'.repeat(300)), true);
    assert.equal(validIncomingAuditName('office', 'A'.repeat(301)), false);
    assert.equal(validIncomingAuditName('student', 'Citizen Test Person'), false);
  });
});
