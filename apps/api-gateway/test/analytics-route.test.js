// TT2: the "analytics" and "reports" aliases for Oversight, and the backend-only analytics endpoints (AC5).
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { serviceTargets } from '../src/lib/routes.js';
import { makeWithGateway, startUpstreams } from './helpers.js';

let stack;
let targets;
let seen;
before(async () => {
  stack = await startUpstreams(['logs', 'operations']);
  seen = stack.seen;
  // analytics and reports reach the very same Oversight instance as logs (LOGS_URL).
  targets = { ...stack.targets, analytics: stack.targets.logs, reports: stack.targets.logs };
});
after(() => stack.close());

const withGateway = makeWithGateway(() => targets);
const okToken = async () => ({ ok: true });
const reached = () => seen.logs.length + seen.operations.length;

describe('TT2 gateway aliases', () => {
  it('analytics and reports point to LOGS_URL like logs', () => {
    const configured = serviceTargets({ LOGS_URL: 'https://oversight.example.test/' });
    assert.equal(configured.analytics, 'https://oversight.example.test');
    assert.equal(configured.reports, 'https://oversight.example.test');
    assert.equal(configured.logs, 'https://oversight.example.test');
  });

  it('forwards health without a token and other reads with a token (future report APIs stay reachable)', async () => {
    await withGateway({ tokenCheck: okToken }, async (base) => {
      for (const alias of ['analytics', 'reports']) {
        const health = await fetch(`${base}/api/${alias}/health`);
        assert.equal(health.status, 200, alias);
        assert.equal(seen.logs.at(-1).url, '/api/health');
        const read = await fetch(`${base}/api/${alias}/kpi/summary?office=1`, { headers: { authorization: 'Bearer a.b.c' } });
        assert.equal(read.status, 200);
        assert.equal(seen.logs.at(-1).url, '/api/kpi/summary?office=1');
      }
      const noToken = await fetch(`${base}/api/reports/kpi/summary`);
      assert.equal(noToken.status, 401);
    });
  });

  it('AC5: ingestion and export are blocked for every method and alias, even with a user token and a service key', async () => {
    await withGateway({ tokenCheck: okToken }, async (base) => {
      const before = reached();
      const paths = [];
      for (const alias of ['logs', 'analytics', 'reports']) {
        paths.push(`/api/${alias}/analytics-events`, `/api/${alias}/analytics-events/`, `/api/${alias}/analytics-events/x`,
          `/api/${alias}/Analytics-Events`, `/api/${alias}/%61nalytics-events`, `/api/${alias}/analytics%2Devents`,
          `/api/${alias}//analytics-events`, `/api/${alias}/%2e%2e/analytics-events`, `/api/${alias}/jobs/analytics-backfill`);
      }
      paths.push('/api/operations/transactions/analytics-export', '/api/operations/transactions/analytics-export/',
        '/api/operations/transactions/analytics-export?limit=500', '/api/operations/transactions/ANALYTICS-EXPORT',
        '/api/operations/transactions/%61nalytics-export', '/api/operations/jobs/analytics-outbox');
      for (const path of paths) {
        for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
          const response = await fetch(`${base}${path}`, {
            method,
            headers: { authorization: 'Bearer valid.user.token', 'x-service-key': 'guessed-or-leaked' },
            body: ['GET', 'HEAD'].includes(method) ? undefined : '{"events":[]}',
          });
          assert.equal(response.status, 404, `${method} ${path}`);
        }
      }
      assert.equal(reached(), before, 'nothing reached Oversight or Operations');
    });
  });

  it('audit-event writes are blocked through the new aliases too; the read-only viewer still works', async () => {
    await withGateway({ tokenCheck: okToken }, async (base) => {
      const before = seen.logs.length;
      for (const alias of ['logs', 'analytics', 'reports']) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          assert.equal((await fetch(`${base}/api/${alias}/audit-events`, { method, headers: { authorization: 'Bearer a.b.c' }, body: method === 'DELETE' ? undefined : '{}' })).status, 404, `${method} ${alias}`);
        }
      }
      assert.equal(seen.logs.length, before);
      const view = await fetch(`${base}/api/logs/audit-events?page=1`, { headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(view.status, 200);
    });
  });

  it('other Operations transaction routes are unaffected', async () => {
    await withGateway({ tokenCheck: okToken }, async (base) => {
      const list = await fetch(`${base}/api/operations/transactions?page=1`, { headers: { authorization: 'Bearer a.b.c' } });
      assert.equal(list.status, 200);
      assert.equal(seen.operations.at(-1).url, '/api/transactions?page=1');
      assert.equal(seen.operations.at(-1).headers['x-service-key'], undefined, 'a browser never presents the service key');
    });
  });
});
