// S8-56: the public tracking-number check, and the optional rule (COMPLAINT_REQUIRE_TRACKING=true) that a complaint needs a confirmed number.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkTrackingNumber, trackingRequired } from '../src/modules/complaints/tracking-check.js';
import { fileComplaint } from '../src/modules/complaints/complaints.js';
import { OFFICE_A } from './helpers.js';

const env = { OPERATIONS_SERVICE_URL: 'http://ops', SERVICE_KEY: 'k' };
const answer = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
const good = (over = {}) => ({ office_id: OFFICE_A, category: 'DELAYED_SERVICE', description: 'Waited three weeks.', ...over });

describe('checkTrackingNumber', () => {
  it('asks Operations with the service key and returns only office, service and the Manila day', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = { url, key: init.headers['x-service-key'] }; return { ok: true, status: 200, json: async () => ({ found: true, office_id: OFFICE_A.toUpperCase(), office_name: 'Registrar', service_name: 'TOR', started_at: '2026-11-17T17:30:00Z', client_email: 'secret@x.ph' }) }; };
    const result = await checkTrackingNumber(' REG-1 ', { env, fetchImpl });
    assert.equal(seen.url, 'http://ops/api/internal/tracking-check?tracking_no=REG-1');
    assert.equal(seen.key, 'k');
    assert.deepEqual(result, { found: true, office_id: OFFICE_A, office_name: 'Registrar', service_name: 'TOR', date: '2026-11-18' }); // 01:30 Manila on the 18th
    assert.ok(!JSON.stringify(result).includes('secret'));
  });
  it('says not found without calling Operations for an empty number, and for an unknown one', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ found: false }) }; };
    assert.deepEqual(await checkTrackingNumber('  ', { env, fetchImpl }), { found: false });
    assert.equal(calls, 0);
    assert.deepEqual(await checkTrackingNumber('NOPE', { env, fetchImpl }), { found: false });
  });
  it('fails closed with 503 when Operations or the key is missing, down or answers an error', async () => {
    await assert.rejects(checkTrackingNumber('A', { env: {}, fetchImpl: answer({}) }), (e) => e.status === 503);
    await assert.rejects(checkTrackingNumber('A', { env, fetchImpl: async () => { throw new Error('down'); } }), (e) => e.status === 503);
    await assert.rejects(checkTrackingNumber('A', { env, fetchImpl: answer({}, 500) }), (e) => e.status === 503);
  });
});

describe('complaint needs a confirmed number unless switched off', () => {
  it('is on by default and off only when COMPLAINT_REQUIRE_TRACKING=false', () => {
    assert.equal(trackingRequired({}), true);
    assert.equal(trackingRequired({ COMPLAINT_REQUIRE_TRACKING: 'true' }), true);
    assert.equal(trackingRequired({ COMPLAINT_REQUIRE_TRACKING: 'false' }), false);
  });
  const required = { COMPLAINT_REQUIRE_TRACKING: 'true' };
  const never = async () => assert.fail('must not reach the database');
  const db = { query: never };
  it('refuses a missing number', async () => {
    await assert.rejects(fileComplaint(db, good(), { env: required, isActiveOffice: async () => true, checkTracking: never }), (e) => e.status === 400 && /tracking number/i.test(e.details.tracking_no));
  });
  it('refuses a number that does not exist', async () => {
    await assert.rejects(fileComplaint(db, good({ tracking_no: 'X' }), { env: required, isActiveOffice: async () => true, checkTracking: async () => ({ found: false }) }), (e) => e.status === 400 && /could not find/i.test(e.details.tracking_no));
  });
  it('refuses a number from a different office', async () => {
    const other = '11111111-1111-4111-8111-111111111111';
    await assert.rejects(fileComplaint(db, good({ tracking_no: 'X' }), { env: required, isActiveOffice: async () => true, checkTracking: async () => ({ found: true, office_id: other }) }), (e) => e.status === 400 && 'office_id' in e.details);
  });
});
