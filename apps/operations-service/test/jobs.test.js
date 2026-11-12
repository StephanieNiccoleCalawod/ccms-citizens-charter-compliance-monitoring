// TT1: local HTTP jobs require CRON_SECRET and retain outbox delivery behavior.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { GET as acknowledgementEmails } from '../src/app/api/jobs/acknowledgement-emails/route.js';
import { GET as acknowledgementEmailsRetry } from '../src/app/api/jobs/acknowledgement-emails/retry/route.js';
import { GET as analyticsOutbox } from '../src/app/api/jobs/analytics-outbox/route.js';
import { GET as autoClose } from '../src/app/api/jobs/auto-close/route.js';
import { GET as computePending } from '../src/app/api/jobs/compute-pending/route.js';
import { GET as outboxRoute } from '../src/app/api/jobs/outbox/route.js';
import { GET as receiptEmails } from '../src/app/api/jobs/receipt-emails/route.js';
import { PUT as putSettings } from '../src/app/api/settings/route.js';
import { runOutboxDispatch } from '../src/jobs/outbox-dispatch.js';
import { SAFE_RETRY_WINDOW_MS } from '../src/lib/idempotent-mail.js';
import { call, req, resetData, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  await resetData(env.ds);
});
after(async () => env?.teardown());

const route = (handler, path, auth) => handler(new Request(`http://x.test/api/jobs/${path}`, { headers: auth ? { authorization: auth } : {} }));

describe('cron routes (TT1-T2, TC4-OPS-003)', () => {
  const jobs = [
    ['outbox', outboxRoute],
    ['compute-pending', computePending],
    ['auto-close', autoClose],
    ['receipt-emails', receiptEmails],
    ['acknowledgement-emails', acknowledgementEmails],
    ['acknowledgement-emails/retry', acknowledgementEmailsRetry, 'acknowledgement-emails'],
    ['analytics-outbox', analyticsOutbox],
  ];

  it('return 401 without the secret, with a wrong one, or when no secret is configured', async () => {
    for (const [name, handler] of jobs) {
      delete process.env.CRON_SECRET;
      assert.equal((await route(handler, name, 'Bearer anything')).status, 401, `${name} without a configured secret`);
      process.env.CRON_SECRET = 'cron-secret';
      try {
        assert.equal((await route(handler, name)).status, 401, `${name} no header`);
        assert.equal((await route(handler, name, 'Bearer wrong')).status, 401, `${name} wrong secret`);
        const body = await (await route(handler, name, 'Bearer wrong')).json();
        assert.ok(body.error.code && body.error.correlation_id, 'standard 401 body');
      } finally {
        delete process.env.CRON_SECRET;
      }
    }
  });

  it('run once and answer { job, ... } with the right secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    try {
      for (const [name, handler, jobName = name] of jobs) {
        const response = await route(handler, name, 'Bearer cron-secret');
        assert.equal(response.status, 200, name);
        assert.equal((await response.json()).job, jobName);
      }
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it('records all manual local job endpoints without a deployment scheduler', async () => {
    const inventory = JSON.parse(readFileSync(new URL('../../../docs/local-jobs.json', import.meta.url), 'utf8'));
    assert.equal(inventory.automaticScheduling, false);
    const jobs = inventory.services['operations-service'].jobs;
    assert.deepEqual(jobs.map((c) => c.path).sort(), [
      '/api/jobs/acknowledgement-emails',
      '/api/jobs/acknowledgement-emails/retry',
      '/api/jobs/analytics-outbox',
      '/api/jobs/auto-close',
      '/api/jobs/compute-pending',
      '/api/jobs/forecast',
      '/api/jobs/late-risk',
      '/api/jobs/outbox',
      '/api/jobs/receipt-emails',
    ]);
    for (const job of jobs) {
      const handler = await import(new URL(`../src/app${job.path}/route.js`, import.meta.url));
      assert.equal(typeof handler[job.method], 'function');
    }
  });

  it('schedules acknowledgement retries within the deduplication window even if one run is missed', () => {
    const { crons } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const emailPaths = new Set([
      '/api/jobs/receipt-emails',
      '/api/jobs/acknowledgement-emails',
      '/api/jobs/acknowledgement-emails/retry',
    ]);
    const scheduled = crons.filter(({ path }) => emailPaths.has(path));
    assert.deepEqual(new Set(scheduled.map(({ path }) => path)), emailPaths);
    const times = scheduled.map(({ schedule }) => {
      assert.match(schedule, /^\d{1,2} \d{1,2} \* \* \*$/);
      const [minute, hour] = schedule.split(' ').map(Number);
      return hour * 60 + minute;
    }).sort((a, b) => a - b);
    const minutesPerDay = 24 * 60;
    const maxScheduleDelay = 60;
    for (const [index, time] of times.entries()) {
      const next = times[(index + 2) % times.length];
      const gap = (next - time + minutesPerDay) % minutesPerDay;
      assert.ok((gap + maxScheduleDelay) * 60_000 < SAFE_RETRY_WINDOW_MS);
    }
  });
});

describe('outbox delivery (TT1-T2)', () => {
  it('sends the audit events a change left in the outbox, once, with the service key', async () => {
    const saved = await call(putSettings, req('PUT', '/settings', { token: tokens.superAdmin, body: { hold_enabled: true, counters_enabled: false, auto_close_days_simple: null, auto_close_days_complex: null, auto_close_days_highly_technical: null, version: 1 } }));
    assert.equal(saved.status, 200);
    const sent = [];
    process.env.LOGS_SERVICE_URL = 'http://logs.test/api';
    process.env.SERVICE_KEY = 'job-key';
    try {
      const fetchImpl = async (url, init) => {
        sent.push({ url, key: init.headers['x-service-key'], body: JSON.parse(init.body) });
        return new Response('{}', { status: 201 });
      };
      const first = await runOutboxDispatch({ fetchImpl });
      assert.equal(first.skipped, false);
      assert.ok(first.sent >= 1);
      assert.ok(sent.every((s) => s.url === 'http://logs.test/api/audit-events' && s.key === 'job-key'));
      assert.ok(sent.some((s) => s.body.action === 'TRANSACTION_SETTINGS_UPDATED' && s.body.entity_type === 'transaction_settings'));
      assert.deepEqual(await runOutboxDispatch({ fetchImpl }), { skipped: false, sent: 0, failed: 0 }, 'nothing is sent twice');
    } finally {
      delete process.env.LOGS_SERVICE_URL;
      process.env.SERVICE_KEY = 'test-service-key-0123456789';
    }
  });

  it('is skipped (and says why) when Logs is not configured', async () => {
    delete process.env.LOGS_SERVICE_URL;
    assert.equal((await runOutboxDispatch()).skipped, true);
  });
});
