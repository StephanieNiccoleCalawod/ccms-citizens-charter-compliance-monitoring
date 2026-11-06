import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERVER_ERROR_MESSAGE, auditErrorResult } from '../../src/lib/ui/audit-log.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('audit log failure handling (source checks, not a browser)', () => {
  const page = read('src/app/logs/page.js');
  it('says a failure once, in the table, with a Retry that asks again; no banner repeats it', () => {
    assert.ok(!page.includes('<ErrorBanner'));
    assert.ok(page.includes('data-testid="audit-error">{state.error}'));
    assert.ok(page.includes('onClick={() => run(applied, 1)}') && page.includes('Retry'));
    assert.ok(page.includes("kind={state.error ? 'error' : 'empty'}"));
  });
  it('an empty state shows only when the request succeeded (a failed request never reads as "No audit entries yet")', () => {
    const error = page.indexOf('state.error\n');
    const empty = page.indexOf("'No audit entries yet.'");
    assert.ok(error > 0 && empty > error);
    assert.ok(page.includes('Loading audit log...'));
  });
  it('a server failure gives the real status message, not an empty table', () => {
    assert.equal(auditErrorResult({ status: 500 }).message, SERVER_ERROR_MESSAGE);
    assert.equal(auditErrorResult({ status: 401 }).message, 'Your session has ended. Please sign in again.');
    assert.equal(auditErrorResult({ code: 'NETWORK_ERROR', message: 'offline' }).message, 'offline');
  });
  it('keeps the request, the newest-first order and the Manila dates the service defines', () => {
    const api = read('src/lib/api/logs.js');
    assert.ok(api.includes('newest first (occurred_at DESC)'));
    assert.ok(page.includes('listAuditEvents(filters, page, apiFetch, requestedPageSize)'));
    assert.ok(page.includes("formatDateTime(event.occurred_at)"));
  });
});
