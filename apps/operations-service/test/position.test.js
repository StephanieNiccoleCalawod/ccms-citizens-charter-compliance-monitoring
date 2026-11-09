// CC046 (Operations): the starter's position is copied at Start; Identity down never blocks a Start.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { createIdentityClient, identityBaseUrl } from '../src/modules/transaction/identity-client.js';
import { startTransaction } from '../src/modules/transaction/start.js';
import { OFFICE_A, SERVICE_A, USERS, resetData, seedCoreServices, setupTestEnv, staff } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const body = () => ({ service_id: SERVICE_A, client_type: 'STUDENT', client_reference: null, client_email: null, requirements_confirmed: true });
const startWith = (identity, user = staff(USERS.staffA)) => startTransaction(env.ds, { core: createCoreClient(), identity, now: () => new Date() }, user, body());
const stored = async (id) => (await env.ds.query('SELECT started_by_position FROM transactions WHERE transaction_id = $1', [id]))[0].started_by_position;
const jsonResponse = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

describe('CC046 position at Start', () => {
  it('AC3: a new transaction carries the starter\'s position, and a later change of the account leaves it unchanged', async () => {
    let position = 'Administrative Aide III';
    const identity = { positionOf: async () => position };
    const t = await startWith(identity);
    assert.equal(t.started_by_position, 'Administrative Aide III');
    assert.equal(await stored(t.transaction_id), 'Administrative Aide III');
    position = 'Registrar II'; // the account is edited later
    const { loadTransactionRow } = await import('../src/modules/transaction/db.js');
    const { toTransactionDto } = await import('../src/modules/transaction/dto.js');
    assert.equal(toTransactionDto(await loadTransactionRow(env.ds, t.transaction_id)).started_by_position, 'Administrative Aide III');
  });

  it('Identity down or silent: the Start still works with an empty position', async () => {
    const t = await startWith({ positionOf: async () => null });
    assert.equal(t.status, 'IN_PROGRESS');
    assert.equal(t.started_by_position, null);
    assert.equal(await stored(t.transaction_id), null);
  });

  it('with no Identity client at all (not configured) the Start works', async () => {
    const t = await startWith(null);
    assert.equal(t.started_by_position, null);
  });

  it('the position is not written to the audit entry', async () => {
    await startWith({ positionOf: async () => 'SECRET-POSITION-LABEL' });
    const all = await env.ds.query('SELECT payload FROM audit_outbox');
    assert.ok(all.length > 0);
    assert.ok(!JSON.stringify(all).includes('SECRET-POSITION-LABEL'));
  });
});

describe('CC046 identity client', () => {
  const clientWith = (fetchImpl) => createIdentityClient({ baseUrl: 'http://identity.test/api', serviceKey: 'k', fetchImpl, timeoutMs: 200 });

  it('asks Identity with the service key and returns the trimmed position', async () => {
    const calls = [];
    const client = clientWith(async (url, init) => {
      calls.push({ url, key: init.headers['x-service-key'] });
      return jsonResponse(200, { account_id: USERS.staffA, position: '  Clerk II ' });
    });
    assert.equal(await client.positionOf(USERS.staffA), 'Clerk II');
    assert.deepEqual(calls, [{ url: `http://identity.test/api/internal/accounts/${USERS.staffA}`, key: 'k' }]);
  });

  it('every failure gives null and never throws', async () => {
    const cases = [
      async () => { throw new Error('connection refused'); },
      async () => jsonResponse(500, {}),
      async () => jsonResponse(404, {}),
      async () => jsonResponse(401, {}),
      async () => new Response('not json', { status: 200 }),
      async () => jsonResponse(200, { position: 5 }),
      async () => jsonResponse(200, { position: 'x'.repeat(101) }),
      async () => jsonResponse(200, { position: '   ' }),
    ];
    for (const fetchImpl of cases) assert.equal(await clientWith(fetchImpl).positionOf(USERS.staffA), null);
  });

  it('a slow Identity is cut off by the timeout', async () => {
    const slow = clientWith((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const started = Date.now();
    assert.equal(await slow.positionOf(USERS.staffA), null);
    assert.ok(Date.now() - started < 2000);
  });

  it('is empty when IDENTITY_URL is not set, and accepts the URL with or without /api', async () => {
    assert.equal(await createIdentityClient({ baseUrl: null }).positionOf(USERS.staffA), null);
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://127.0.0.1:3001/' }), 'http://127.0.0.1:3001/api');
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://127.0.0.1:3001/api' }), 'http://127.0.0.1:3001/api');
    assert.equal(identityBaseUrl({}), null);
  });
});
