// GET /internal/complaint-links - S8-54, extended by S8-6x for a Super Admin's all-offices Report by Person: omitting
// office_id entirely counts complaints across every office instead of refusing the request.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { GET } from '../src/app/api/internal/complaint-links/route.js';
import { OFFICE_A, OFFICE_B, SERVICE_KEY, call, req, setupTestEnv } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => env?.teardown());

async function insertComplaint(officeId, trackingNo) {
  await env.ds.query(
    `INSERT INTO complaints (complaint_id, reference, office_id, category, description, status, tracking_no)
     VALUES ($1, $2, $3, 'OTHER', 'x', 'RECEIVED', $4)`,
    [randomUUID(), `CMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, officeId, trackingNo],
  );
}

test('no service key is refused', async () => {
  assert.equal((await call(GET, req('GET', '/internal/complaint-links'))).status, 401);
});

test('an office_id that is not a UUID is refused', async () => {
  assert.equal((await call(GET, req('GET', '/internal/complaint-links?office_id=not-a-uuid', { key: SERVICE_KEY }))).status, 400);
});

test('with an office_id, only that office\'s complaints are counted', async () => {
  await insertComplaint(OFFICE_A, 'PUP-OSAS-20261101-0001');
  await insertComplaint(OFFICE_A, 'PUP-OSAS-20261101-0001');
  await insertComplaint(OFFICE_B, 'PUP-REG-20261101-0002');
  const { status, body } = await call(GET, req('GET', `/internal/complaint-links?office_id=${OFFICE_A}`, { key: SERVICE_KEY }));
  assert.equal(status, 200);
  assert.deepEqual(body.items, [{ tracking_no: 'PUP-OSAS-20261101-0001', count: 2 }]);
});

test('without an office_id, every office\'s complaints are counted together', async () => {
  const { status, body } = await call(GET, req('GET', '/internal/complaint-links', { key: SERVICE_KEY }));
  assert.equal(status, 200);
  const byTracking = Object.fromEntries(body.items.map((i) => [i.tracking_no, i.count]));
  assert.equal(byTracking['PUP-OSAS-20261101-0001'], 2);
  assert.equal(byTracking['PUP-REG-20261101-0002'], 1);
});
