// CC039: only Take a ticket is public at the gateway.
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { isPublicApi, resolveRoute } from '../src/lib/routes.js';
import { listen, makeWithGateway } from './helpers.js';

const seen = [];
let server;
let targets;
before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, bytes: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{}');
    });
  });
  targets = { operations: `http://127.0.0.1:${await listen(server)}` };
});
after(() => server.close());
const withGateway = makeWithGateway(() => targets);
const rejectAll = async () => ({ ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' });

describe('CC039 public queue path', () => {
  it('only POST-able Take a ticket path is public; the panel, Call next, Skip and staff issuance are not', () => {
    assert.equal(isPublicApi('operations', '/api/queue/public/tickets'), true);
    for (const path of ['/api/queue', '/api/queue/tickets', '/api/queue/call-next', '/api/queue/tickets/x/skip', '/api/queue/public', '/api/queue/public/tickets/x',
      '/api/transactions/x/receipt', '/api/transactions/x/receipt/image']) {
      assert.equal(isPublicApi('operations', path), false, path);
    }
    assert.deepEqual(resolveRoute('/api/operations/queue/public/tickets'), { name: 'operations', path: '/api/queue/public/tickets' });
    assert.deepEqual(resolveRoute('/api/operations/jobs/receipt-storage-cleanup'), { blocked: true });
  });

  it('forwards Take a ticket without a token, with the client address chain, and refuses the rest without one', async () => {
    await withGateway({ tokenCheck: rejectAll, trustProxy: true }, async (base) => {
      const take = await fetch(`${base}/api/operations/queue/public/tickets`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: '{"office_id":"x"}' });
      assert.equal(take.status, 200);
      assert.equal(seen.at(-1).headers['x-forwarded-for'], '203.0.113.9');
      for (const [method, path] of [['GET', '/queue'], ['POST', '/queue/call-next'], ['POST', '/queue/tickets'], ['POST', '/queue/tickets/abc/skip'],
        ['GET', '/transactions/abc/receipt'], ['GET', '/transactions/abc/receipt/image'], ['DELETE', '/transactions/abc/receipt']]) {
        const r = await fetch(`${base}/api/operations${path}`, { method });
        assert.equal(r.status, 401, `${method} ${path}`);
      }
    });
  });
});
