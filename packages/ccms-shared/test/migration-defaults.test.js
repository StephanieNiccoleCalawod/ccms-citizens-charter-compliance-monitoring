import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDataSource } from '../src/db.js';
import { createRateLimiter } from '../src/rate-limit.js';

test('ordinary database creation does not enable schema synchronization', () => {
  const previous = process.env.DB_SYNCHRONIZE;
  delete process.env.DB_SYNCHRONIZE;
  try {
    const source = createDataSource({ url: 'postgres://local:local@127.0.0.1:1/local', entities: [] });
    assert.equal(source.options.synchronize, false);
    assert.equal(source.options.installExtensions, false);
    assert.equal(createDataSource({ url: 'postgres://local:local@127.0.0.1:1/local', entities: [], synchronize: true }).options.synchronize, true);
    assert.equal(createDataSource({ url: 'postgres://local:local@127.0.0.1:1/local', entities: [], synchronize: true }).options.installExtensions, true);
  } finally {
    if (previous === undefined) delete process.env.DB_SYNCHRONIZE;
    else process.env.DB_SYNCHRONIZE = previous;
  }
});

test('Identity non-consuming lockout checks survive shared-package consolidation', async () => {
  let now = 1000;
  const limiter = createRateLimiter({ now: () => now });
  const options = { limit: 2, windowMs: 10000 };
  for (let i = 0; i < 3; i++) assert.equal((await limiter.check('login', { ...options, consume: false })).allowed, true);
  assert.equal((await limiter.check('login', options)).allowed, true);
  assert.equal((await limiter.check('login', options)).allowed, true);
  assert.equal((await limiter.check('login', { ...options, consume: false })).allowed, false);
  now += 10001;
  assert.equal((await limiter.check('login', { ...options, consume: false })).allowed, true);
});
