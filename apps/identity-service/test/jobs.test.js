import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GET } from '../src/app/api/jobs/outbox/route.js';

const call = (auth) => GET(new Request('http://localhost/api/jobs/outbox', { headers: auth ? { authorization: auth } : {} }));

describe('outbox cron job route', () => {
  it('refuses a call without the cron secret, and when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await call('Bearer anything')).status, 401);
    process.env.CRON_SECRET = 'cron-secret';
    assert.equal((await call()).status, 401);
    assert.equal((await call('Bearer wrong')).status, 401);
  });

  it('runs once with the right secret (reports skipped when Logs is not configured)', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    delete process.env.LOGS_SERVICE_URL;
    const response = await call('Bearer cron-secret');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.job, 'outbox');
    assert.equal(body.skipped, true);
  });

  it('records all manual local job endpoints without a deployment scheduler', async () => {
    const inventory = JSON.parse(readFileSync(new URL('../../../docs/local-jobs.json', import.meta.url), 'utf8'));
    assert.equal(inventory.automaticScheduling, false);
    const jobs = inventory.services['identity-service'].jobs;
    assert.deepEqual(jobs.map((c) => c.path), ['/api/jobs/outbox']);
    for (const job of jobs) {
      const handler = await import(new URL(`../src/app${job.path}/route.js`, import.meta.url));
      assert.equal(typeof handler[job.method], 'function');
    }
  });
});
