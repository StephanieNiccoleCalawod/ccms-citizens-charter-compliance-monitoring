// CC046 (Operations): the starter's position and display name are copied at Start; Identity down never blocks a Start.
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { canAccessTransaction } from '../src/modules/transaction/access.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { loadTransactionRow } from '../src/modules/transaction/db.js';
import { toTransactionDto } from '../src/modules/transaction/dto.js';
import { createIdentityClient, identityBaseUrl } from '../src/modules/transaction/identity-client.js';
import { startTransaction } from '../src/modules/transaction/start.js';
import { NOT_IN_REGISTRY, SERVICE_A, USERS, resetData, seedCoreServices, setupTestEnv, staff } from './helpers.js';

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

const body = () => ({ service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, client_reference: null, client_email: null, requirements_confirmed: true });
const startWith = (identity, user = staff(USERS.staffA)) => startTransaction(env.ds, { core: createCoreClient(), identity, now: () => new Date() }, user, body());
const stored = async (id) => (await env.ds.query('SELECT started_by_position, started_by_name FROM transactions WHERE transaction_id = $1', [id]))[0];
const jsonResponse = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const fake = (answer) => ({ starterOf: async () => answer });

describe('CC046 labels at Start', () => {
  it('AC3: a new transaction carries the starter\'s position and name, and a later change of the account leaves them unchanged', async () => {
    let account = { position: 'Administrative Aide III', name: 'Juan Dela Cruz' };
    const identity = { starterOf: async () => account };
    const t = await startWith(identity);
    assert.equal(t.started_by_position, 'Administrative Aide III');
    assert.equal(t.started_by_name, 'Juan Dela Cruz');
    assert.deepEqual(await stored(t.transaction_id), { started_by_position: 'Administrative Aide III', started_by_name: 'Juan Dela Cruz' });
    account = { position: 'Registrar II', name: 'Juan D. Cruz-Santos' }; // the account is edited and renamed later
    const dto = toTransactionDto(await loadTransactionRow(env.ds, t.transaction_id));
    assert.equal(dto.started_by_position, 'Administrative Aide III');
    assert.equal(dto.started_by_name, 'Juan Dela Cruz');
    const second = await startWith(identity, staff(USERS.staffB));
    assert.equal(second.started_by_position, 'Registrar II', 'a new transaction takes the new value, the old one keeps its own');
  });

  it('keeps one transaction per starter: the labels belong to the person who started it', async () => {
    const a = await startWith({ starterOf: async (id) => ({ position: `pos-${id}`, name: `name-${id}` }) });
    assert.equal(a.started_by, USERS.staffA);
    assert.equal(a.started_by_position, `pos-${USERS.staffA}`);
    assert.equal(a.started_by_name, `name-${USERS.staffA}`);
  });

  it('Identity down or silent: the Start still works with empty labels', async () => {
    const t = await startWith(fake({ position: null, name: null }));
    assert.equal(t.status, 'IN_PROGRESS');
    assert.equal(t.started_by_position, null);
    assert.equal(t.started_by_name, null);
    assert.deepEqual(await stored(t.transaction_id), { started_by_position: null, started_by_name: null });
  });

  it('a client that throws, or answers with the wrong kind of value, still lets the Start work', async () => {
    for (const identity of [{ starterOf: async () => { throw new Error('boom'); } }, fake(undefined), fake(null), fake({ position: 5, name: {} }), fake('text')]) {
      await resetData(env.ds);
      const t = await startWith(identity);
      assert.equal(t.status, 'IN_PROGRESS');
      assert.equal(t.started_by_position, null);
      assert.equal(t.started_by_name, null);
    }
  });

  it('with no Identity client at all (not configured) the Start works', async () => {
    const t = await startWith(null);
    assert.equal(t.started_by_position, null);
    assert.equal(t.started_by_name, null);
  });

  it('no database transaction is open while Operations waits for Identity (a slow Identity holds no lock)', async () => {
    let openWhileWaiting = null;
    const identity = {
      starterOf: async () => {
        const [{ count }] = await env.ds.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
        openWhileWaiting = count;
        return { position: 'Clerk', name: 'Ana' };
      },
    };
    await startWith(identity);
    assert.equal(openWhileWaiting, 0);
  });

  it('the labels are not written to the audit entry', async () => {
    await startWith(fake({ position: 'SECRET-POSITION-LABEL', name: 'SECRET-NAME-LABEL' }));
    const all = await env.ds.query('SELECT payload FROM audit_outbox');
    assert.ok(all.length > 0);
    const text = JSON.stringify(all);
    assert.ok(!text.includes('SECRET-POSITION-LABEL'));
    assert.ok(!text.includes('SECRET-NAME-LABEL'));
    assert.ok(!/position/i.test(text));
  });

  it('the position changes nothing about who may open the transaction (access follows the office and the starter, not the label)', async () => {
    const t = await startWith(fake({ position: 'Director of Everything', name: 'Ana' }));
    const row = await loadTransactionRow(env.ds, t.transaction_id);
    assert.equal(canAccessTransaction(staff(USERS.staffA), row), true);
    assert.equal(canAccessTransaction(staff(USERS.staffB), row), false, 'another staff member is still refused');
    assert.equal(row.started_by, USERS.staffA);
  });
});

describe('CC046 against a real Identity address', () => {
  const listen = (handler) =>
    new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/api` }));
    });

  it('copies both labels from a running Identity, sending the service key', async () => {
    const seen = [];
    const { server, url } = await listen((request, response) => {
      seen.push({ url: request.url, key: request.headers['x-service-key'] });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ account_id: USERS.staffA, full_name: ' Juan Dela Cruz ', position: ' Administrative Aide III ' }));
    });
    try {
      const t = await startWith(createIdentityClient({ baseUrl: url, serviceKey: 'the-service-key', timeoutMs: 1000 }));
      assert.equal(t.started_by_name, 'Juan Dela Cruz');
      assert.equal(t.started_by_position, 'Administrative Aide III');
      assert.deepEqual(seen, [{ url: `/api/internal/accounts/${USERS.staffA}`, key: 'the-service-key' }]);
    } finally {
      server.close();
    }
  });

  it('Identity offline (nothing listening): the Start works with empty labels', async () => {
    const t = await startWith(createIdentityClient({ baseUrl: 'http://127.0.0.1:1/api', serviceKey: 'k', timeoutMs: 1000 }));
    assert.equal(t.status, 'IN_PROGRESS');
    assert.equal(t.started_by_position, null);
    assert.equal(t.started_by_name, null);
  });

  it('Identity that never answers: the Start works once the short timeout passes, with empty labels', async () => {
    const { server, url } = await listen(() => {}); // accepts the request and never replies
    try {
      const began = Date.now();
      const t = await startWith(createIdentityClient({ baseUrl: url, serviceKey: 'k', timeoutMs: 150 }));
      assert.equal(t.status, 'IN_PROGRESS');
      assert.equal(t.started_by_position, null);
      assert.ok(Date.now() - began < 3000, 'did not wait for Identity');
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  it('Identity answering an error or rubbish: the Start works with empty labels', async () => {
    for (const reply of [(r) => { r.statusCode = 500; r.end('{}'); }, (r) => { r.statusCode = 401; r.end('{}'); }, (r) => r.end('<html>not json</html>'), (r) => r.end(JSON.stringify({ full_name: 7, position: ['x'] }))]) {
      await resetData(env.ds);
      const { server, url } = await listen((request, response) => reply(response));
      try {
        const t = await startWith(createIdentityClient({ baseUrl: url, serviceKey: 'k', timeoutMs: 1000 }));
        assert.equal(t.status, 'IN_PROGRESS');
        assert.equal(t.started_by_position, null);
        assert.equal(t.started_by_name, null);
      } finally {
        server.close();
      }
    }
  });

  it('Identity not configured (no IDENTITY_URL): the Start works with empty labels', async () => {
    const t = await startWith(createIdentityClient({ baseUrl: identityBaseUrl({}), serviceKey: 'k' }));
    assert.equal(t.status, 'IN_PROGRESS');
    assert.equal(t.started_by_name, null);
  });
});

describe('CC046 identity client', () => {
  const clientWith = (fetchImpl) => createIdentityClient({ baseUrl: 'http://identity.test/api', serviceKey: 'k', fetchImpl, timeoutMs: 200 });

  it('asks Identity with the service key and returns the trimmed position and name', async () => {
    const calls = [];
    const client = clientWith(async (url, init) => {
      calls.push({ url, key: init.headers['x-service-key'] });
      return jsonResponse(200, { account_id: USERS.staffA, full_name: '  Juan Dela Cruz ', position: '  Clerk II ' });
    });
    assert.deepEqual(await client.starterOf(USERS.staffA), { name: 'Juan Dela Cruz', position: 'Clerk II' });
    assert.equal(await client.positionOf(USERS.staffA), 'Clerk II');
    assert.deepEqual(calls[0], { url: `http://identity.test/api/internal/accounts/${USERS.staffA}`, key: 'k' });
  });

  it('every failure gives empty labels and never throws', async () => {
    const cases = [
      async () => { throw new Error('connection refused'); },
      async () => jsonResponse(500, {}),
      async () => jsonResponse(404, {}),
      async () => jsonResponse(401, {}),
      async () => new Response('not json', { status: 200 }),
      async () => jsonResponse(200, { position: 5, full_name: 5 }),
      async () => jsonResponse(200, { position: 'x'.repeat(101), full_name: 'x'.repeat(201) }),
      async () => jsonResponse(200, { position: '   ', full_name: '   ' }),
    ];
    for (const fetchImpl of cases) {
      assert.deepEqual(await clientWith(fetchImpl).starterOf(USERS.staffA), { name: null, position: null });
      assert.equal(await clientWith(fetchImpl).positionOf(USERS.staffA), null);
    }
  });

  it('keeps one label when only the other is unusable', async () => {
    assert.deepEqual(await clientWith(async () => jsonResponse(200, { full_name: 'Ana', position: 9 })).starterOf(USERS.staffA), { name: 'Ana', position: null });
    assert.deepEqual(await clientWith(async () => jsonResponse(200, { position: 'Clerk' })).starterOf(USERS.staffA), { name: null, position: 'Clerk' });
  });

  it('a slow Identity is cut off by the timeout', async () => {
    const slow = clientWith((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const started = Date.now();
    assert.deepEqual(await slow.starterOf(USERS.staffA), { name: null, position: null });
    assert.ok(Date.now() - started < 2000);
  });

  it('is empty when IDENTITY_URL is not set, and accepts the URL with or without /api', async () => {
    assert.deepEqual(await createIdentityClient({ baseUrl: null }).starterOf(USERS.staffA), { name: null, position: null });
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://127.0.0.1:3001/' }), 'http://127.0.0.1:3001/api');
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://127.0.0.1:3001/api' }), 'http://127.0.0.1:3001/api');
    assert.equal(identityBaseUrl({}), null);
  });

  it('the Start code asks once, with no retry loop', async () => {
    let calls = 0;
    const t = await startWith({ starterOf: async () => { calls++; return { name: null, position: null }; } });
    assert.equal(calls, 1);
    assert.equal(t.status, 'IN_PROGRESS');
  });
});

describe('CC046 the transaction view carries the copied labels', () => {
  it('the list and the detail both show them, and an old row without them shows null', async () => {
    const t = await startWith(fake({ position: 'Clerk', name: 'Ana Cruz' }));
    const row = await loadTransactionRow(env.ds, t.transaction_id);
    for (const detail of [true, false]) {
      const dto = toTransactionDto(row, { detail });
      assert.equal(dto.started_by_name, 'Ana Cruz');
      assert.equal(dto.started_by_position, 'Clerk');
    }
    const old = toTransactionDto({ ...row, started_by_name: undefined, started_by_position: undefined });
    assert.equal(old.started_by_name, null);
    assert.equal(old.started_by_position, null);
  });
});

describe('CC046 migration', () => {
  it('adds the position and name columns to an old table twice, leaves old rows empty and keeps what a new row stores', async () => {
    const { createTestDatabase } = await import('ccms-shared/testing');
    const { migrateSprint5Operations } = await import('../src/lib/migrations/sprint5.js');
    const database = await createTestDatabase({ entities: [] });
    try {
      const ds = database.dataSource;
      const old = '11111111-1111-4111-8111-111111111111';
      await ds.query('CREATE TABLE transactions (transaction_id uuid PRIMARY KEY, status text)');
      await ds.query("INSERT INTO transactions VALUES ($1, 'COMPLETED')", [old]);
      await migrateSprint5Operations(ds);
      await migrateSprint5Operations(ds);
      assert.deepEqual(await ds.query('SELECT started_by_position, started_by_name FROM transactions'), [{ started_by_position: null, started_by_name: null }]);
      const columns = await ds.query(`SELECT column_name, character_maximum_length AS len, is_nullable FROM information_schema.columns WHERE table_name = 'transactions' AND column_name IN ('started_by_position','started_by_name') ORDER BY column_name`);
      assert.deepEqual(columns, [
        { column_name: 'started_by_name', len: 200, is_nullable: 'YES' },
        { column_name: 'started_by_position', len: 100, is_nullable: 'YES' },
      ]);
      await ds.query("UPDATE transactions SET started_by_position = 'Clerk', started_by_name = 'Ana' WHERE transaction_id = $1", [old]);
      await migrateSprint5Operations(ds);
      assert.deepEqual(await ds.query('SELECT started_by_position, started_by_name FROM transactions'), [{ started_by_position: 'Clerk', started_by_name: 'Ana' }]);
    } finally {
      await database.drop();
    }
  });
});
