import { randomUUID } from 'node:crypto';
import { ANALYTICS_MAX_BATCH, AnalyticsValidationError, serviceApiBase, validateAnalyticsExportPage } from 'ccms-shared';
import { applyAnalyticsSnapshots } from './store.js';

// TT2 backfill: Oversight pulls every transaction from Operations (GET /api/transactions/analytics-export, service key)
// page by page and passes each page through the same validation and conditional upsert as the live feed.
//
//  Lease      analytics_backfill_state has one row per job. A run takes it with a fresh lease_token only when no other
//             run holds it or that run's lease expired (crashed run). Two runs never work at the same time.
//  Progress   each page's upsert and the new cursor commit in ONE database transaction, and only while this run still
//             owns the lease; a crash leaves the last committed cursor, and the next run resumes there.
//  Passes     a pass starts at the first page (cursor null) and ends at the page whose next_cursor is null; the next
//             invocation starts a new pass. A run never continues past the end of a pass.
//  Budget     the hosted job stops after `maxPages` pages or `timeBudgetMs` (checked before each fetch) and keeps its
//             cursor for the next invocation; the CLI usually runs a whole pass.
//  Safety     backfill pages can never regress a newer live event (the upsert keeps the higher version); rows inserted
//             behind the cursor during a pass arrive through the live outbox. Nothing is sent anywhere else: no audit
//             copy, no email, no FMS/SCMS push, no change in Operations.
//  Failure    an HTTP error, timeout or invalid page records a short last_error (never a body), releases the lease and
//             returns ok:false; the cursor is unchanged, so a retry resumes from the same page.

export const BACKFILL_JOB = 'analytics-backfill';
export const HOSTED_BACKFILL_BUDGET = Object.freeze({ maxPages: 20, timeBudgetMs: 20_000 });

class BackfillError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

async function acquire(dataSource, { token, leaseSeconds, reset }) {
  await dataSource.query('INSERT INTO analytics_backfill_state (job_name) VALUES ($1) ON CONFLICT (job_name) DO NOTHING', [BACKFILL_JOB]);
  const [row] = rowsOf(
    await dataSource.query(
      `UPDATE analytics_backfill_state
          SET lease_token = $2, lease_until = now() + make_interval(secs => $3), updated_at = now()
        WHERE job_name = $1 AND (lease_token IS NULL OR lease_until IS NULL OR lease_until <= now())
        RETURNING next_cursor, pass_started_at`,
      [BACKFILL_JOB, token, leaseSeconds],
    ),
  );
  if (!row) return null;
  if (reset || row.pass_started_at === null) {
    // A new pass from the first page (also the explicit --reset recovery). Counters of finished passes stay.
    await dataSource.query(
      `UPDATE analytics_backfill_state SET next_cursor = NULL, pass_started_at = now(), pass_rows = 0, updated_at = now()
        WHERE job_name = $1 AND lease_token = $2`,
      [BACKFILL_JOB, token],
    );
    return { cursor: null, newPass: true };
  }
  return { cursor: row.next_cursor, newPass: false };
}

async function release(dataSource, token, lastError = null) {
  await dataSource.query(
    `UPDATE analytics_backfill_state SET lease_token = NULL, lease_until = NULL, last_error = $3, updated_at = now()
      WHERE job_name = $1 AND lease_token = $2`,
    [BACKFILL_JOB, token, lastError],
  );
}

async function fetchPage({ base, serviceKey, cursor, pageSize, fetchImpl, timeoutMs }) {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (cursor) query.set('cursor', cursor);
  let response;
  try {
    response = await fetchImpl(`${base}/transactions/analytics-export?${query}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'x-service-key': serviceKey, 'x-correlation-id': randomUUID() },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new BackfillError(timedOut ? 'EXPORT_TIMEOUT' : 'EXPORT_UNREACHABLE', timedOut ? 'Operations did not answer in time' : 'Operations could not be reached');
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new BackfillError('EXPORT_REJECTED', `Operations responded ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new BackfillError('EXPORT_INVALID', 'Operations sent an unreadable page');
  }
  try {
    return validateAnalyticsExportPage(body, { maxItems: pageSize });
  } catch (err) {
    if (err instanceof AnalyticsValidationError) throw new BackfillError('EXPORT_INVALID', 'Operations sent a page that does not match the analytics contract');
    throw err;
  }
}

/** Upserts one page and moves the cursor in one transaction, only while this run owns the lease. */
async function commitPage(dataSource, { token, page, leaseSeconds }) {
  return dataSource.transaction(async (manager) => {
    const owned = await manager.query('SELECT 1 FROM analytics_backfill_state WHERE job_name = $1 AND lease_token = $2 FOR UPDATE', [BACKFILL_JOB, token]);
    if (!owned.length) throw new BackfillError('LEASE_LOST', 'Another backfill run took over');
    const result = await applyAnalyticsSnapshots(manager, page.items);
    if (page.next_cursor === null) {
      await manager.query(
        `UPDATE analytics_backfill_state
            SET next_cursor = NULL, pass_started_at = NULL, pass_rows = 0, passes_completed = passes_completed + 1,
                last_pass_completed_at = now(), last_error = NULL, lease_until = now() + make_interval(secs => $3), updated_at = now()
          WHERE job_name = $1 AND lease_token = $2`,
        [BACKFILL_JOB, token, leaseSeconds],
      );
    } else {
      await manager.query(
        `UPDATE analytics_backfill_state
            SET next_cursor = $3, pass_rows = pass_rows + $4, last_error = NULL,
                lease_until = now() + make_interval(secs => $5), updated_at = now()
          WHERE job_name = $1 AND lease_token = $2`,
        [BACKFILL_JOB, token, page.next_cursor, page.items.length, leaseSeconds],
      );
    }
    return result;
  });
}

/**
 * Runs the backfill for at most `maxPages` pages / `timeBudgetMs`. Returns a bounded summary (counts only):
 *   { ok, skipped?, reason?, error?, pages, rows, applied, ignored, pass_completed, resume_pending }
 */
export async function runAnalyticsBackfill({
  dataSource,
  operationsUrl,
  serviceKey,
  fetchImpl = fetch,
  pageSize = ANALYTICS_MAX_BATCH,
  maxPages = HOSTED_BACKFILL_BUDGET.maxPages,
  timeBudgetMs = HOSTED_BACKFILL_BUDGET.timeBudgetMs,
  leaseSeconds = 120,
  timeoutMs = 15_000,
  reset = false,
  clock = () => Date.now(),
}) {
  const base = serviceApiBase(operationsUrl);
  if (!base || !serviceKey) return { ok: false, skipped: true, reason: 'OPERATIONS_SERVICE_URL and SERVICE_KEY are required' };
  const size = Math.min(Math.max(1, Math.trunc(pageSize)), ANALYTICS_MAX_BATCH);
  const token = randomUUID();
  const state = await acquire(dataSource, { token, leaseSeconds, reset });
  if (!state) return { ok: true, skipped: true, reason: 'ALREADY_RUNNING' };

  const summary = { ok: true, pages: 0, rows: 0, applied: 0, ignored: 0, pass_completed: false, resume_pending: true };
  const started = clock();
  let cursor = state.cursor;
  try {
    while (summary.pages < maxPages && clock() - started < timeBudgetMs) {
      const page = await fetchPage({ base, serviceKey, cursor, pageSize: size, fetchImpl, timeoutMs });
      const result = await commitPage(dataSource, { token, page, leaseSeconds });
      summary.pages += 1;
      summary.rows += page.items.length;
      summary.applied += result.applied;
      summary.ignored += result.ignored;
      cursor = page.next_cursor;
      if (cursor === null) {
        summary.pass_completed = true;
        summary.resume_pending = false;
        break;
      }
    }
    await release(dataSource, token);
    return summary;
  } catch (err) {
    if (!(err instanceof BackfillError)) {
      await release(dataSource, token, 'Backfill failed').catch(() => {});
      throw err;
    }
    if (err.code !== 'LEASE_LOST') await release(dataSource, token, err.message);
    return { ...summary, ok: false, error: err.code };
  }
}
