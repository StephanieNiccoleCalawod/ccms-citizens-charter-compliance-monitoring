import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cronRoute, requireCronSecret } from '../src/index.js';

const req = (auth) => new Request('http://x.test/api/jobs/outbox', { headers: auth ? { authorization: auth } : {} });

describe('cron secret', () => {
  it('accepts only the exact bearer secret', () => {
    assert.doesNotThrow(() => requireCronSecret(req('Bearer s3cret'), 's3cret'));
    assert.throws(() => requireCronSecret(req('Bearer nope'), 's3cret'), { status: 401 });
    assert.throws(() => requireCronSecret(req(), 's3cret'), { status: 401 });
    assert.throws(() => requireCronSecret(req('Bearer '), 's3cret'), { status: 401 });
  });

  it('never runs when CRON_SECRET is not configured', () => {
    assert.throws(() => requireCronSecret(req('Bearer anything'), ''), { code: 'CRON_NOT_CONFIGURED' });
  });
});

describe('cronRoute', () => {
  it('401 without the secret and does not run the job; 200 with it and runs the job once', async () => {
    process.env.CRON_SECRET = 'abc';
    let runs = 0;
    const GET = cronRoute('demo', async () => ({ sent: 2, failed: 0, runs: ++runs }));
    const denied = await GET(req());
    assert.equal(denied.status, 401);
    assert.equal(runs, 0);
    const ok = await GET(req('Bearer abc'));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { job: 'demo', sent: 2, failed: 0, runs: 1 });
    delete process.env.CRON_SECRET;
  });

  it('reports a failing job in the standard error format', async () => {
    process.env.CRON_SECRET = 'abc';
    const GET = cronRoute('boom', async () => {
      throw new Error('db down');
    });
    const response = await GET(req('Bearer abc'));
    assert.equal(response.status, 500);
    delete process.env.CRON_SECRET;
  });
});
