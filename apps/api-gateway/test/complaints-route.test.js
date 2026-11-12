// CC032 / CC033: the two public complaint routes pass the gateway with no token; nothing else under /api/logs/complaints does.
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { isPublicApi } from '../src/lib/routes.js';
import { makeWithGateway, startUpstreams } from './helpers.js';

let stack;
before(async () => { stack = await startUpstreams(['logs']); });
after(() => stack.close());
const withGateway = makeWithGateway(() => stack.targets);
const rejectAll = async () => ({ ok: false, status: 401 });

describe('public complaint routes', () => {
  it('lists exactly the file and status paths as public', () => {
    assert.equal(isPublicApi('logs', '/api/complaints'), true);
    assert.equal(isPublicApi('logs', '/api/complaints/status'), true);
    assert.equal(isPublicApi('logs', '/api/complaints/status/'), true);
    for (const path of ['/api/complaints/abc', '/api/complaints/status/x', '/api/complaintsx', '/api/audit-events', '/api/reports']) assert.equal(isPublicApi('logs', path), false, path);
  });

  it('forwards both without a token, and still demands one elsewhere', async () => {
    await withGateway({ tokenCheck: rejectAll }, async (base) => {
      const post = await fetch(`${base}/api/logs/complaints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(post.status, 200);
      const get = await fetch(`${base}/api/logs/complaints/status?ref=CMP-20261113-ABCDEF`);
      assert.equal(get.status, 200);
      const other = await fetch(`${base}/api/logs/reports`);
      assert.equal(other.status, 401);
      const staff = await fetch(`${base}/api/logs/complaints/some-id`);
      assert.equal(staff.status, 401);
    });
  });

  it('CC034: the staff list passes with a token and the token reaches Oversight, which checks it itself', async () => {
    const before = stack.seen.logs.length;
    await withGateway({ tokenCheck: async () => ({ ok: true, status: 200 }) }, async (base) => {
      const list = await fetch(`${base}/api/logs/complaints?status=RECEIVED`, { headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(list.status, 200);
      const one = await fetch(`${base}/api/logs/complaints/11111111-1111-4111-8111-111111111111`, { headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(one.status, 200);
      const ack = await fetch(`${base}/api/logs/complaints/11111111-1111-4111-8111-111111111111/acknowledge`, { method: 'POST', headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(ack.status, 200);
    });
    const got = stack.seen.logs.slice(before);
    assert.equal(got.length, 3);
    for (const hit of got) assert.equal(hit.headers.authorization, 'Bearer a.b.c');
    assert.equal(got[0].url, '/api/complaints?status=RECEIVED');
  });
});
