import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { OutboxEvent, RateLimitHit, createDbStore, createMemoryStore, createRateLimiter, dispatchOutbox, publicLimits, recordAudit } from '../src/index.js';
import { createTestDatabase } from '../src/testing/index.js';

let testDb;
before(async () => {
  testDb = await createTestDatabase({ entities: [RateLimitHit, OutboxEvent] });
});
after(() => testDb?.drop());

const rule = { limit: 3, windowMs: 60_000 };

for (const [name, makeStore] of [
  ['memory store', () => createMemoryStore()],
  ['database store (Neon table)', () => createDbStore(async () => testDb.dataSource)],
]) {
  describe(`rate limit: ${name}`, () => {
    it('allows up to the limit, then blocks with a retry time, then opens in a new window', async () => {
      let now = 1_000_000;
      const limiter = createRateLimiter({ now: () => now, store: makeStore() });
      const key = `k-${name}`;
      for (let i = 0; i < 3; i += 1) assert.equal((await limiter.check(key, rule)).allowed, true);
      const blocked = await limiter.check(key, rule);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.retryAfterSeconds, 60);
      now += 59_000;
      assert.equal((await limiter.check(key, rule)).retryAfterSeconds, 1);
      now += 2_000;
      assert.equal((await limiter.check(key, rule)).allowed, true);
    });

    it('counts keys separately and reset() clears them', async () => {
      const limiter = createRateLimiter({ store: makeStore() });
      for (let i = 0; i < 4; i += 1) await limiter.check('a', rule);
      assert.equal((await limiter.check('a', rule)).allowed, false);
      assert.equal((await limiter.check('b', rule)).allowed, true);
      await limiter.reset();
      assert.equal((await limiter.check('a', rule)).allowed, true);
    });
  });
}

describe('rate limit: shared counter and failure behaviour', () => {
  it('two limiters on the same database share one count (as two serverless instances would)', async () => {
    const make = () => createRateLimiter({ store: createDbStore(async () => testDb.dataSource) });
    const one = make();
    const two = make();
    await one.reset();
    await Promise.all([one.check('shared', rule), two.check('shared', rule), one.check('shared', rule)]);
    assert.equal((await two.check('shared', rule)).allowed, false);
  });

  it('lets requests through (and warns) when the store is down, unless failOpen is false', async () => {
    const broken = { hit: async () => { throw new Error('db down'); }, reset: async () => {} };
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal((await createRateLimiter({ store: broken }).check('x', rule)).allowed, true);
    } finally {
      console.warn = warn;
    }
    await assert.rejects(() => createRateLimiter({ store: broken, failOpen: false }).check('x', rule), /db down/);
  });

  it('reads the limits from the environment with safe defaults', () => {
    assert.deepEqual(publicLimits({}), { limit: 60, windowMs: 60_000 });
    assert.deepEqual(publicLimits({ PUBLIC_RATE_LIMIT: '5', PUBLIC_RATE_WINDOW_SECONDS: '10' }), { limit: 5, windowMs: 10_000 });
    assert.deepEqual(publicLimits({ PUBLIC_RATE_LIMIT: 'abc' }), { limit: 60, windowMs: 60_000 });
  });
});

describe('outbox claim', () => {
  it('two overlapping dispatch runs never send the same event twice', async () => {
    const ds = testDb.dataSource;
    const ids = [];
    for (let n = 0; n < 6; n += 1) {
      ids.push(await ds.transaction((m) => recordAudit(m, { actor: { id: '33333333-3333-4333-8333-333333333333', role: 'super_admin' }, action: 'X', entityType: 'x', entityId: `c-${n}` })));
    }
    const seen = [];
    const fetchImpl = async (_u, init) => {
      seen.push(JSON.parse(init.body).audit_id);
      await new Promise((r) => setTimeout(r, 20));
      return new Response('{}', { status: 201 });
    };
    const opts = { logsUrl: 'http://logs.test/api', serviceKey: 'k', fetchImpl, batchSize: 3 };
    await Promise.all([dispatchOutbox(ds, opts), dispatchOutbox(ds, opts)]);
    for (const id of ids) assert.equal(seen.filter((s) => s === id).length, 1);
  });
});
