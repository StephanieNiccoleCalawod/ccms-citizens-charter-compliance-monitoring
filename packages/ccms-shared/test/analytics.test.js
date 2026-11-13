// TT2 shared analytics contract: strict validation, the snapshot mapper's allowlist, cursors, seeds and body limits.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_MAX_BATCH,
  ANALYTICS_SNAPSHOT_FIELD_NAMES,
  buildAnalyticsEvent,
  decodeAnalyticsCursor,
  encodeAnalyticsCursor,
  isSeededTrackingNo,
  latestSnapshotPerTransaction,
  readBoundedJson,
  serviceApiBase,
  snapshotFromTransactionRow,
  validateAnalyticsBatch,
  validateAnalyticsExportPage,
  validateAnalyticsSnapshot,
} from '../src/index.js';

const SPEC_FIELDS = [
  'transaction_id', 'tracking_no', 'office_id', 'service_id', 'service_code', 'classification', 'client_type',
  'standard_days', 'standard_hours', 'standard_minutes', 'started_at', 'ended_at', 'status',
  'elapsed_working_minutes', 'is_compliant', 'variance_minutes', 'held_minutes', 'is_backdated', 'started_outside_hours',
  'registry_status', 'registry_miss_reason', 'outcome', 'started_by_user_id', 'ended_by_user_id', 'counter_id', 'event_version',
];

/** A full Operations row, including every private column the mapper must drop. */
function operationsRow(over = {}) {
  return {
    transaction_id: randomUUID(), tracking_no: 'PUP-REG-20261015-0007', service_id: randomUUID(), service_code: 'PUP-REG-TOR-001',
    service_name: 'Transcript of Records', office_id: randomUUID(), office_code: 'PUP-REG', office_name: 'Registrar',
    service_classification: 'SIMPLE', standard_id: randomUUID(), standard_duration_days: 0, standard_duration_hours: 1,
    standard_duration_minutes: 30, counter_id: null, client_type: 'ALUMNI', client_reference: '2019-00001-CM-0',
    client_email: 'alumna@example.test', started_at: new Date('2026-10-15T02:00:00Z'), started_by: randomUUID(),
    ended_at: null, ended_by: null, status: 'IN_PROGRESS', elapsed_working_minutes: null, is_compliant: null,
    variance_minutes: null, cancel_reason: 'cancel text', backdate_reason: 'backdate text', is_backdated: false,
    held_minutes: 0, hold_reason: 'hold text', hold_started_at: null, started_by_position: 'Clerk', started_by_name: 'A. Staff',
    started_outside_hours: true, outcome: null, disapproval_reason: 'disapproval text', disapproval_notice_given: null,
    version: 4, analytics_event_version: 0, receipt_email_status: 'NONE', ip_address: '203.0.113.9',
    registry_student_number: '2019-00001-CM-2', registry_note: 'registry note',
    ...over,
  };
}

describe('TT2 analytics contract', () => {
  it('the snapshot has exactly the specified fields and event types', () => {
    // CC040 adds one OPTIONAL field; every TT2 field stays required.
    assert.deepEqual([...ANALYTICS_SNAPSHOT_FIELD_NAMES].sort(), [...SPEC_FIELDS, 'queue_wait_minutes'].sort());
    assert.deepEqual([...ANALYTICS_EVENT_TYPES], ['TRANSACTION_STARTED', 'TRANSACTION_HELD', 'TRANSACTION_RESUMED', 'TRANSACTION_COMPLETED', 'TRANSACTION_RESULT_COMPUTED', 'TRANSACTION_CANCELLED', 'TRANSACTION_AUTO_CLOSED']);
    assert.equal(ANALYTICS_MAX_BATCH, 500);
  });

  it('CC040: queue_wait_minutes is optional, nullable, whole and non-negative, and left out while null', () => {
    const base = snapshotFromTransactionRow(operationsRow());
    assert.equal(Object.hasOwn(base, 'queue_wait_minutes'), false, 'no wait: left out, so an older receiver still accepts it');
    const measured = snapshotFromTransactionRow({ ...operationsRow(), queue_wait_minutes: 0 });
    assert.strictEqual(measured.queue_wait_minutes, 0, 'a measured zero is kept');
    assert.equal(validateAnalyticsSnapshot({ ...base }).queue_wait_minutes, undefined, 'an older snapshot without the field is valid');
    assert.equal(Object.hasOwn(validateAnalyticsSnapshot({ ...base, queue_wait_minutes: null }), 'queue_wait_minutes'), false);
    for (const bad of [-1, 1.5, '4', true]) assert.throws(() => validateAnalyticsSnapshot({ ...base, queue_wait_minutes: bad }), /invalid/);
  });

  it('the mapper copies only allowlisted fields, renames source columns, keeps nulls and defaults registry to NONE', () => {
    const row = operationsRow();
    const snapshot = snapshotFromTransactionRow(row);
    assert.deepEqual(Object.keys(snapshot).sort(), [...SPEC_FIELDS].sort());
    assert.equal(snapshot.classification, 'SIMPLE');
    assert.deepEqual([snapshot.standard_days, snapshot.standard_hours, snapshot.standard_minutes], [0, 1, 30]);
    assert.equal(snapshot.started_by_user_id, row.started_by);
    assert.equal(snapshot.started_at, '2026-10-15T02:00:00.000Z');
    assert.deepEqual([snapshot.elapsed_working_minutes, snapshot.is_compliant, snapshot.variance_minutes, snapshot.outcome], [null, null, null, null]);
    assert.deepEqual([snapshot.registry_status, snapshot.registry_miss_reason], ['NONE', null]);
    assert.equal(snapshot.event_version, 0);
    const text = JSON.stringify(snapshot);
    for (const secret of ['2019-00001', 'alumna@', 'text', 'Clerk', 'A. Staff', 'Registrar', 'Transcript', '203.0.113.9', 'registry note']) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it('the mapper consumes persisted registry fields when they exist (CC044), codes only', () => {
    const snapshot = snapshotFromTransactionRow(operationsRow({ registry_status: 'NOT_FOUND', registry_miss_reason: 'NEW_ENROLLEE' }));
    assert.deepEqual([snapshot.registry_status, snapshot.registry_miss_reason], ['NOT_FOUND', 'NEW_ENROLLEE']);
    assert.throws(() => snapshotFromTransactionRow(operationsRow({ registry_status: 'NOT_FOUND', registry_miss_reason: 'their name changed' })), /invalid/);
    assert.throws(() => snapshotFromTransactionRow(operationsRow({ registry_status: 'MATCHED', registry_miss_reason: 'OTHER' })), /invalid/);
  });

  it('rejects unknown properties at every level, including __proto__', () => {
    const snapshot = snapshotFromTransactionRow(operationsRow());
    const event = buildAnalyticsEvent({ eventType: 'TRANSACTION_STARTED', snapshot });
    assert.throws(() => validateAnalyticsSnapshot({ ...snapshot, client_email: 'x' }), (err) => err.status === 400 && 'client_email' in err.details);
    assert.throws(() => validateAnalyticsSnapshot(JSON.parse(JSON.stringify(snapshot).replace('{', '{"__proto__":{"x":1},'))), (err) => '__proto__' in err.details);
    assert.throws(() => validateAnalyticsBatch({ events: [{ ...event, note: 'x' }] }), (err) => 'events[0].note' in err.details);
    assert.throws(() => validateAnalyticsBatch({ events: [], extra: 1 }));
    const missing = { ...snapshot };
    delete missing.transaction_id;
    assert.throws(() => validateAnalyticsSnapshot(missing), (err) => err.details.transaction_id === 'Is required');
  });

  it('batch size: 500 is valid, 501 is BATCH_TOO_LARGE; an empty batch is valid', () => {
    const snapshot = snapshotFromTransactionRow(operationsRow());
    const e = () => buildAnalyticsEvent({ eventType: 'TRANSACTION_STARTED', snapshot: { ...snapshot, transaction_id: randomUUID() } });
    assert.equal(validateAnalyticsBatch({ events: Array.from({ length: 500 }, e) }).length, 500);
    assert.throws(() => validateAnalyticsBatch({ events: Array.from({ length: 501 }, e) }), (err) => err.code === 'BATCH_TOO_LARGE');
    assert.deepEqual(validateAnalyticsBatch({ events: [] }), []);
  });

  it('same transaction and version with different content is CONFLICTING_DUPLICATE; identical duplicates collapse', () => {
    const snapshot = snapshotFromTransactionRow(operationsRow({ analytics_event_version: 3 }));
    const a = buildAnalyticsEvent({ eventType: 'TRANSACTION_HELD', snapshot });
    const b = buildAnalyticsEvent({ eventType: 'TRANSACTION_HELD', snapshot: { ...snapshot, held_minutes: 9 } });
    assert.throws(() => validateAnalyticsBatch({ events: [a, b] }), (err) => err.code === 'CONFLICTING_DUPLICATE');
    const events = validateAnalyticsBatch({ events: [a, { ...a, event_id: randomUUID() }] });
    const { latest, superseded } = latestSnapshotPerTransaction(events.map((x) => x.snapshot));
    assert.equal(latest.length, 1);
    assert.equal(superseded, 1);
  });

  it('export pages are validated with the same rules', () => {
    const item = snapshotFromTransactionRow(operationsRow());
    assert.equal(validateAnalyticsExportPage({ schema_version: 1, items: [item], next_cursor: null }).items.length, 1);
    assert.throws(() => validateAnalyticsExportPage({ schema_version: 1, items: [{ ...item, hold_reason: 'x' }], next_cursor: null }));
    assert.throws(() => validateAnalyticsExportPage({ schema_version: 2, items: [], next_cursor: null }));
    assert.throws(() => validateAnalyticsExportPage({ schema_version: 1, items: [item, item], next_cursor: null }, { maxItems: 1 }));
  });

  it('K16 seed marker boundaries', () => {
    assert.equal(isSeededTrackingNo('PUP-REG-20261015-9000'), false);
    assert.equal(isSeededTrackingNo('PUP-REG-20261015-9001'), true);
    assert.equal(isSeededTrackingNo('PUP-REG-20261015-9999'), true);
    for (const bad of ['PUP-REG-20261015-10000', 'PUP-REG-20261015-901', '9001', 'PUP-REG-20261015-9O01', null, undefined, 9001]) {
      assert.equal(isSeededTrackingNo(bad), false, String(bad));
    }
  });

  it('cursors round-trip and anything else is INVALID_CURSOR', () => {
    const id = randomUUID();
    assert.equal(decodeAnalyticsCursor(encodeAnalyticsCursor(id)), id);
    for (const bad of ['', 'abc', 'a'.repeat(300), Buffer.from('{"v":2,"after":"x"}').toString('base64url'), Buffer.from(JSON.stringify({ v: 1, after: id, x: 1 })).toString('base64url')]) {
      assert.throws(() => decodeAnalyticsCursor(bad), (err) => err.code === 'INVALID_CURSOR', bad);
    }
  });

  it('service URLs end in /api exactly once', () => {
    for (const raw of ['http://x:3002', 'http://x:3002/', 'http://x:3002/api', 'http://x:3002/api/']) assert.equal(serviceApiBase(raw), 'http://x:3002/api');
    assert.equal(serviceApiBase(''), null);
  });

  it('readBoundedJson stops at the byte limit even without content-length', async () => {
    const request = (body, headers = {}) => new Request('http://x.test/', { method: 'POST', body, headers });
    assert.deepEqual(await readBoundedJson(request('{"events":[]}'), 100), { events: [] });
    await assert.rejects(readBoundedJson(request(`{"x":"${'a'.repeat(200)}"}`), 100), (err) => err.status === 413);
    await assert.rejects(readBoundedJson(request('{}', { 'content-length': '1000' }), 100), (err) => err.status === 413);
    await assert.rejects(readBoundedJson(request('[1]'), 100), (err) => err.code === 'INVALID_JSON');
  });
});
