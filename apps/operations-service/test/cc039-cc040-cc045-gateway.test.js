// CC039 / CC040 / CC045 end to end through the real API gateway (routing, public-path rule, token check) in front of the real
// Operations route handlers on a test database: anonymous ticket, staff call, Start with the ticket, receipts by role.
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createMemoryStore, createRateLimiter } from 'ccms-shared';
import { createGateway } from '../../api-gateway/src/lib/gateway.js';
import { POST as publicIssue } from '../src/app/api/queue/public/tickets/route.js';
import { GET as board } from '../src/app/api/queue/route.js';
import { POST as callNext } from '../src/app/api/queue/call-next/route.js';
import { POST as staffIssue } from '../src/app/api/queue/tickets/route.js';
import { POST as skip } from '../src/app/api/queue/tickets/[id]/skip/route.js';
import { POST as startTx } from '../src/app/api/transactions/route.js';
import { DELETE as receiptDelete, GET as receiptGet, POST as receiptPost } from '../src/app/api/transactions/[id]/receipt/route.js';
import { GET as receiptImage } from '../src/app/api/transactions/[id]/receipt/image/route.js';
import { setQueueLimiter } from '../src/modules/queue/limit.js';
import { createMemoryStorage, setReceiptStorage } from '../src/modules/receipts/storage.js';
import { OFFICE_A, resetData, seedCoreServices, setupTestEnv, SERVICE_A, tokens } from './helpers.js';

const ROUTES = [
  ['POST', /^\/api\/queue\/public\/tickets$/, publicIssue],
  ['GET', /^\/api\/queue$/, board],
  ['POST', /^\/api\/queue\/call-next$/, callNext],
  ['POST', /^\/api\/queue\/tickets$/, staffIssue],
  ['POST', /^\/api\/queue\/tickets\/([^/]+)\/skip$/, skip],
  ['POST', /^\/api\/transactions$/, startTx],
  ['GET', /^\/api\/transactions\/([^/]+)\/receipt$/, receiptGet],
  ['POST', /^\/api\/transactions\/([^/]+)\/receipt$/, receiptPost],
  ['DELETE', /^\/api\/transactions\/([^/]+)\/receipt$/, receiptDelete],
  ['GET', /^\/api\/transactions\/([^/]+)\/receipt\/image$/, receiptImage],
];

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
function serve(handler) {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) || !chunks.length ? undefined : Buffer.concat(chunks) });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
}
// The Operations app: the same handlers Next.js would route to.
const operationsApp = (request) => {
  const path = new URL(request.url).pathname;
  for (const [method, pattern, handler] of ROUTES) {
    const m = pattern.exec(path);
    if (m && method === request.method) return handler(request, { params: Promise.resolve(m[1] ? { id: m[1] } : {}) });
  }
  return new Response('{}', { status: 404 });
};

let env;
let base;
let servers = [];
let storage;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
  await resetData(env.ds);
  setQueueLimiter(createRateLimiter({ store: createMemoryStore() }));
  storage = createMemoryStorage();
  setReceiptStorage(storage);
  const ops = serve(operationsApp);
  const opsPort = await listen(ops);
  // The gateway's token check: a valid user token signed by the test Identity keys.
  const tokenCheck = async (token) => {
    try {
      await env.keys.verifier(token);
      return { ok: true };
    } catch {
      return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' };
    }
  };
  const gateway = serve(createGateway({ targets: { operations: `http://127.0.0.1:${opsPort}` }, tokenCheck, trustProxy: true }));
  base = `http://127.0.0.1:${await listen(gateway)}/api/operations`;
  servers = [ops, gateway];
});
after(async () => {
  for (const s of servers) { s.close(); s.closeAllConnections?.(); }
  setQueueLimiter(null);
  setReceiptStorage(null);
  await env?.teardown();
});

const json = async (r) => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null, headers: r.headers });
const send = (method, path, { token, body, headers = {} } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
}).then(json);

describe('through the gateway', () => {
  it('anonymous ticket, staff call, Start with the ticket, then receipts by role', async () => {
    const anonymous = await send('POST', '/queue/public/tickets', { body: { office_id: OFFICE_A, priority_group: 'SENIOR_CITIZEN' }, headers: { 'x-forwarded-for': '198.51.100.4' } });
    assert.equal(anonymous.status, 201, JSON.stringify(anonymous.body));
    assert.equal(anonymous.body.ticket_no, 'PUP-OSAS-001');
    assert.equal((await send('POST', '/queue/tickets', { body: {} })).status, 401, 'staff issuance needs a session at the gateway');
    assert.equal((await send('POST', '/queue/tickets', { token: tokens.officeStaffA, body: {} })).body.ticket_no, 'PUP-OSAS-002');
    assert.equal((await send('POST', '/queue/call-next', { token: tokens.executive, body: { office_id: OFFICE_A } })).status, 403);
    const called = await send('POST', '/queue/call-next', { token: tokens.officeStaffA, body: {} });
    assert.equal(called.body.ticket.ticket_no, 'PUP-OSAS-001', 'priority first');
    const early = await send('POST', `/queue/tickets/${called.body.ticket.ticket_id}/skip`, { token: tokens.officeStaffA, body: {} });
    assert.equal(early.body.error.code, 'SKIP_TOO_EARLY');

    const started = await send('POST', '/transactions', { token: tokens.officeStaffA, body: { service_id: SERVICE_A, client_type: 'EMPLOYEE', requirements_confirmed: true, queue_ticket_id: called.body.ticket.ticket_id } });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.equal(started.body.queue_wait_minutes, 0);
    const id = started.body.transaction_id;

    const form = new FormData();
    form.append('file', new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'receipt.png', { type: 'image/png' }));
    form.append('or_number', '00042');
    form.append('amount', '75.5');
    form.append('receipt_date', '2026-11-12');
    assert.equal((await send('POST', `/transactions/${id}/receipt`, { body: form })).status, 401);
    const up = await send('POST', `/transactions/${id}/receipt`, { token: tokens.officeHeadA, body: form });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.deepEqual([up.body.receipt.or_number, up.body.receipt.amount], ['00042', '75.50']);

    assert.equal((await send('GET', `/transactions/${id}/receipt`, { token: tokens.executive })).status, 403);
    assert.equal((await send('GET', `/transactions/${id}/receipt/image`, { token: tokens.executive })).status, 403);
    assert.equal((await send('GET', `/transactions/${id}/receipt/image`)).status, 401);
    assert.equal((await send('GET', `/transactions/${id}/receipt/image`, { token: tokens.officeStaffB })).status, 403);
    const image = await fetch(`${base}/transactions/${id}/receipt/image`, { headers: { authorization: `Bearer ${tokens.officeStaffA}` } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await image.arrayBuffer())[0], 0x89);

    assert.equal((await send('DELETE', `/transactions/${id}/receipt`, { token: tokens.superAdmin })).status, 200);
    assert.equal((await send('GET', `/transactions/${id}/receipt/image`, { token: tokens.officeStaffA })).status, 404, 'gone after delete');
    assert.equal(storage.objects.size, 0);
  });
});
