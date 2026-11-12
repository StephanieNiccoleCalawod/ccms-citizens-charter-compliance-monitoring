// CC027 change (K14): the gateway adds no transaction role rule of its own. It sends every transaction read and write, for any
// signed-in role, to Operations unchanged, and Operations decides (Executive: GET list/detail allowed with the allowlisted view;
// every write 403 — apps/operations-service/test/cc027-executive-read.test.js). The backend-only and job paths stay blocked.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolveRoute } from '../src/lib/routes.js';

const TARGETS = { operations: 'http://operations.test', logs: 'http://logs.test', analytics: 'http://logs.test', reports: 'http://logs.test' };
const ID = '44444444-4444-4444-8444-444444444444';

describe('CC027 / K14 gateway routing for transactions', () => {
  it('forwards list and detail reads to Operations with the path and query unchanged', () => {
    assert.deepEqual(resolveRoute('/api/operations/transactions?office_id=x&status=COMPLETED', TARGETS, 'GET'), { name: 'operations', path: '/api/transactions?office_id=x&status=COMPLETED' });
    assert.deepEqual(resolveRoute(`/api/operations/transactions/${ID}`, TARGETS, 'GET'), { name: 'operations', path: `/api/transactions/${ID}` });
  });

  it('forwards every write to Operations too, so the service (not the gateway) answers 403 to an Executive', () => {
    for (const path of ['/api/operations/transactions', `/api/operations/transactions/${ID}/hold`, `/api/operations/transactions/${ID}/resume`, `/api/operations/transactions/${ID}/complete`, `/api/operations/transactions/${ID}/cancel`]) {
      assert.deepEqual(resolveRoute(path, TARGETS, 'POST'), { name: 'operations', path: path.replace('/api/operations', '/api') }, path);
    }
  });

  it('still blocks the TT2 export and the jobs for every method', () => {
    for (const method of ['GET', 'POST']) {
      assert.deepEqual(resolveRoute('/api/operations/transactions/analytics-export', TARGETS, method), { blocked: true }, method);
      assert.deepEqual(resolveRoute('/api/operations/jobs/outbox', TARGETS, method), { blocked: true }, method);
    }
  });

  it('still reaches the KPI endpoint (CC050 outcome totals) on Oversight through the analytics alias', () => {
    assert.deepEqual(resolveRoute('/api/analytics/analytics/kpis?from=2026-10-01&to=2026-10-31', TARGETS, 'GET'), { name: 'analytics', path: '/api/analytics/kpis?from=2026-10-01&to=2026-10-31' });
  });
});
