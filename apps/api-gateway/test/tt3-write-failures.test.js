import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGateway } from '../src/lib/gateway.js';

// Inject at the upstream boundary: no local listener or live backend required.
for (const [name, status, code] of [
  ['Error', 502, 'SERVICE_UNAVAILABLE'],
  ['TimeoutError', 504, 'SERVICE_TIMEOUT'],
  ['AbortError', 504, 'SERVICE_TIMEOUT'],
]) {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    test(`TT3 ${method} ${name}: unknown save state, no automatic replay`, async () => {
      let calls = 0;
      const gateway = createGateway({
        targets: { operations: 'https://operations.test' },
        fetchImpl: async (_url, init) => {
          calls++;
          assert.equal(init.method, method);
          throw Object.assign(new Error('injected upstream failure'), { name });
        },
      });
      const response = await gateway(new Request('https://gateway.test/api/operations/transactions', {
        method, headers: { 'x-correlation-id': 'tt3-write-failure' }, body: '{}',
      }));
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(calls, 1);
      assert.equal(body.error.code, code);
      assert.equal(body.error.correlation_id, 'tt3-write-failure');
      assert.equal(body.error.message, 'We could not confirm whether your changes were saved. Check the transaction list before submitting again.');
    });
  }
}

test('TT3 GET retains the read-error message', async () => {
  const gateway = createGateway({
    targets: { operations: 'https://operations.test' },
    fetchImpl: async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); },
  });
  const response = await gateway(new Request('https://gateway.test/api/operations/transactions'));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.message, 'The service took too long to answer. Please try again.');
});
