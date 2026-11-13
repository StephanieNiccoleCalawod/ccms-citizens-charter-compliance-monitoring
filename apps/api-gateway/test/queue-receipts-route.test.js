// CC039: exactly one queue path is public (Take a ticket). Every other queue route and every CC045 receipt route needs a token at
// the gateway; Operations then checks the role and the office. The receipt image passes through unchanged and uncached.
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { isPublicApi, resolveRoute } from '../src/lib/routes.js';
import { listen, makeWithGateway } from './helpers.js';

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const seen = [];
let server;
let targets;
before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, bytes: Buffer.concat(chunks) });
      if (req.url.endsWith('/receipt/image')) {
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
        return res.end(IMAGE);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{}');
    });
  });
  targets = { operations: `http://127.0.0.1:${await listen(server)}` };
});
after(() => server.close());
const withGateway = makeWithGateway(() => targets);
const rejectAll = async () => ({ ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' });
const acceptAll = async () => ({ ok: true });

describe('CC039 public queue path', () => {
  it('only POST-able Take a ticket path is public; the panel, Call next, Skip and staff issuance are not', () => {
    assert.equal(isPublicApi('operations', '/api/queue/public/tickets'), true);
    assert.equal(isPublicApi('operations', '/api/queue/public/now-serving'), true); // CC059: the TV screen
    assert.equal(isPublicApi('operations', '/api/ratings'), true); // CC057: rate with a receipt code, no account
    for (const path of ['/api/queue', '/api/queue/tickets', '/api/queue/call-next', '/api/queue/tickets/x/skip', '/api/queue/public', '/api/queue/public/tickets/x', '/api/ratings/summary', '/api/ratings/x',
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

describe('CC045 receipts through the gateway', () => {
  it('a multipart upload reaches Operations intact and the image comes back byte for byte, uncached', async () => {
    await withGateway({ tokenCheck: acceptAll }, async (base) => {
      const form = new FormData();
      form.append('file', new File([IMAGE], 'r.jpg', { type: 'image/jpeg' }));
      form.append('or_number', '0001');
      const up = await fetch(`${base}/api/operations/transactions/abc/receipt`, { method: 'POST', headers: { authorization: 'Bearer a.b.c' }, body: form });
      assert.equal(up.status, 200);
      const got = seen.at(-1);
      assert.match(got.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.ok(got.bytes.includes(IMAGE) && got.bytes.includes(Buffer.from('0001')));
      assert.equal(got.headers.authorization, 'Bearer a.b.c');

      const image = await fetch(`${base}/api/operations/transactions/abc/receipt/image`, { headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('cache-control'), 'private, no-store');
      assert.equal(image.headers.get('content-type'), 'image/jpeg');
      assert.ok(Buffer.from(await image.arrayBuffer()).equals(IMAGE));
    });
  });
});
