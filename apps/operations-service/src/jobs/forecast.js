/**
 * Nightly forecast job for CC038.
 *
 * Runs for every distinct office_id that appears in the transactions table.
 * For each office it generates an office-level forecast and then, for each distinct
 * service_id in that office, a service-level forecast (skipped if TOO_FEW).
 *
 * Advisory lock 43436/602 prevents concurrent runs (e.g. a retry racing the original).
 *
 * Vercel execution-limit note (K23/3):
 *   For a typical university deployment (~20 offices, ~10 services each = ~220 runs),
 *   each forecast takes ~1-2 seconds of CPU + calendar lookups (cached per office). Total
 *   runtime is roughly 20 * (1 + 10 * 0.5) = ~120 seconds. This exceeds the Vercel Hobby
 *   60-second function limit but fits within the Pro 300-second limit. For production,
 *   either use Vercel Pro, or split into per-office cron jobs (one route per office), or
 *   use a background worker (K23 option 3). For the local/test sprint, one unbounded run is fine.
 *
 * The job does not fail silently: errors are logged and the row is written with status='ERROR'.
 */

import { getDb } from '../lib/data-source.js';
import { createCalendarClient } from '../lib/forecast/calendar-client.js';
import { computeForecast, saveForecastRun } from '../lib/forecast/forecast-service.js';

export async function runForecastJob() {
  const db = await getDb();

  // Lock to prevent concurrent runs
  await db.query('SELECT pg_advisory_lock(43436, 602)');
  let released = false;
  const release = async () => {
    if (!released) { released = true; await db.query('SELECT pg_advisory_unlock(43436, 602)'); }
  };

  try {
    // Find all distinct offices that have transactions
    const officeRows = await db.query('SELECT DISTINCT office_id FROM transactions ORDER BY 1');
    const offices = officeRows.map((r) => r.office_id);

    const calClient = createCalendarClient();
    let ran = 0, failed = 0;

    for (const officeId of offices) {
      // --- Office-level forecast ---
      try {
        const result = await computeForecast(db, calClient, { officeId, serviceId: null });
        await saveForecastRun(db, result);
        ran++;
      } catch (err) {
        failed++;
        console.error(`[forecast-job] office ${officeId} failed:`, err?.message);
        await saveForecastRun(db, {
          officeId, serviceId: null, model: 'NONE', mae: null,
          history: [], forecast: [], weeklyTotal: 0, status: 'ERROR',
          errorCode: 'INTERNAL_ERROR', errorMessage: String(err?.message ?? err),
          historyWorkingDays: 0, historicalTransactionCount: 0,
          historyStartDate: null, historyEndDate: null,
          generatedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      // --- Service-level forecasts for this office ---
      const serviceRows = await db.query(
        'SELECT DISTINCT service_id FROM transactions WHERE office_id = $1 ORDER BY 1',
        [officeId],
      );
      for (const { service_id: serviceId } of serviceRows) {
        try {
          const result = await computeForecast(db, calClient, { officeId, serviceId });
          await saveForecastRun(db, result);
          ran++;
        } catch (err) {
          failed++;
          console.error(`[forecast-job] office ${officeId} service ${serviceId} failed:`, err?.message);
        }
      }
    }

    console.log(`[forecast-job] done — ran ${ran}, failed ${failed}`);
    return { offices: offices.length, ran, failed };
  } finally {
    await release();
  }
}
