// S8-56 (Operations side): GET /internal/tracking-check answers only found / not found and the office, service and day.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET } from '../src/app/api/internal/tracking-check/route.js';
import { SERVICE_KEY, call, insertTransaction, req, resetData, seedCoreServices, setupTestEnv } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); seedCoreServices(env.core); });
after(async () => env?.teardown());
beforeEach(async () => { await resetData(env.ds); });

const withKey = (path) => call(GET, req('GET', path, { key: SERVICE_KEY }));

describe('GET /internal/tracking-check', () => {
  it('refuses a caller without the service key', async () => {
    const res = await call(GET, req('GET', '/internal/tracking-check?tracking_no=X'));
    assert.equal(res.status, 401);
  });

  it('says found with only office, service and start time for a real number (trimmed, any letter case)', async () => {
    await insertTransaction(env.ds, { tracking_no: 'REG-20261118-0001' });
    const res = await withKey(`/internal/tracking-check?tracking_no=${encodeURIComponent(' reg-20261118-0001 ')}`);
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.found, true);
    assert.deepEqual(Object.keys(body).sort(), ['found', 'office_id', 'office_name', 'service_name', 'started_at']);
  });

  it('says not found for an unknown number and returns nothing else', async () => {
    const { body } = await withKey('/internal/tracking-check?tracking_no=NOPE-1');
    assert.deepEqual(body, { found: false });
  });

  it('refuses an empty number', async () => {
    assert.equal((await withKey('/internal/tracking-check?tracking_no=')).status, 400);
  });
});
