// Sprint 7 CC059: the public "Now serving" read for a waiting-area TV. The database is real.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createMemoryStore, createRateLimiter } from 'ccms-shared';
import { GET as nowServingRoute } from '../src/app/api/queue/public/now-serving/route.js';
import { setNowServingLimiter } from '../src/modules/queue/now-serving.js';
import { callNextTicket, issueTicket } from '../src/modules/queue/tickets.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { OFFICE_A, OFFICE_B, call, req, resetData, setupTestEnv, staff, USERS } from './helpers.js';

let env;
let core;
before(async () => { env = await setupTestEnv(); core = createCoreClient(); });
after(async () => { setNowServingLimiter(null); await env?.teardown(); });
beforeEach(async () => { env.core.reset(); await resetData(env.ds); setNowServingLimiter(createRateLimiter({ store: createMemoryStore() })); });

const now = () => new Date();
const issue = (office = OFFICE_A, lane = 'REGULAR') => issueTicket(env.ds, { core, now }, { officeId: office, lane, actor: null });
const view = (query = `?office_id=${OFFICE_A}`, headers = { 'x-forwarded-for': '203.0.113.5' }) => call(nowServingRoute, req('GET', `/queue/public/now-serving${query}`, { headers }));

describe('CC059 public read', () => {
  it('AC1: gives the current ticket and the next three, and follows "Call next" on the next read', async () => {
    assert.deepEqual((await view()).body.next, []);
    for (let i = 0; i < 5; i += 1) await issue();
    const before = (await view()).body;
    assert.equal(before.current, null);
    assert.deepEqual(before.next, ['PUP-OSAS-001', 'PUP-OSAS-002', 'PUP-OSAS-003']);
    await callNextTicket(env.ds, { now }, staff(USERS.staffA), {});
    const after = (await view()).body;
    assert.equal(after.current, 'PUP-OSAS-001');
    assert.deepEqual(after.next, ['PUP-OSAS-002', 'PUP-OSAS-003', 'PUP-OSAS-004']);
  });
  it('AC2: works without a token and carries display numbers only, never cached', async () => {
    await issue();
    const res = await view();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(res.body).sort(), ['current', 'next', 'queue_date']);
    assert.ok(res.body.next.every((n) => /^PUP-[A-Z]+-\d{3,}$/.test(n)));
    assert.ok(!/token|email|name|lane|ticket_id/i.test(JSON.stringify(res.body)));
  });
  it('shows one office only', async () => {
    await issue(OFFICE_A);
    await issue(OFFICE_B);
    const a = (await view(`?office_id=${OFFICE_A}`)).body;
    const b = (await view(`?office_id=${OFFICE_B}`)).body;
    assert.deepEqual([a.next, b.next], [['PUP-OSAS-001'], ['PUP-ACAD-001']]);
  });
  it('refuses a missing or malformed office, and is read-only', async () => {
    assert.equal((await view('')).status, 400);
    assert.equal((await view('?office_id=nope')).status, 400);
    assert.equal(typeof (await import('../src/app/api/queue/public/now-serving/route.js')).POST, 'undefined');
  });
  it('answers 429 with Retry-After when the limiter says so', async () => {
    setNowServingLimiter({ check: async () => ({ allowed: false, retryAfterSeconds: 7 }) });
    const res = await view();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '7');
  });
});
