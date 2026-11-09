/**
 * Daily transaction aggregation for the forecast service (CC038).
 *
 * Aggregates received (started_at) transaction counts per office and service,
 * grouped by Manila working date. Zero-fills working days with no transactions.
 *
 * "Received" means started_at: the moment a staff member opened the transaction
 * on behalf of the citizen, which is the standard CCMS definition of receipt.
 *
 * Working-day zero fill:
 *   For each calendar date in the history window, we ask Core whether that date
 *   is a working day for the given office. Dates where is_working_day=false are
 *   excluded entirely (they cannot receive transactions). Dates that ARE working
 *   days but have zero transactions are represented as 0, not omitted.
 *
 * We look back HISTORY_SCAN_DAYS calendar days to find at least MIN_HISTORY
 * working days. The returned series is exactly the most recent `maxWorkingDays`
 * working-day counts, ordered from oldest to newest.
 */

import { manilaDate, addCalendarDays } from './calendar-client.js';

const HISTORY_SCAN_DAYS = 90; // scan at most 90 calendar days back to find working days

/**
 * Query the transactions table for daily counts in a calendar range.
 * Returns a Map keyed by 'YYYY-MM-DD' with the count per day.
 *
 * @param {import('typeorm').DataSource} dataSource
 * @param {{ officeId: string, serviceId?: string|null, fromDate: string, toDate: string }} opts
 */
async function queryDailyCounts(dataSource, { officeId, serviceId, fromDate, toDate }) {
  // started_at is timestamptz; AT TIME ZONE 'Asia/Manila' gives the Manila local date.
  const params = [officeId, `${fromDate}T00:00:00+08:00`, `${toDate}T23:59:59+08:00`];
  let sql = `
    SELECT
      (started_at AT TIME ZONE 'Asia/Manila')::date::text AS working_date,
      COUNT(*)::int AS cnt
    FROM transactions
    WHERE office_id = $1
      AND started_at BETWEEN $2 AND $3
  `;
  if (serviceId) {
    sql += ' AND service_id = $4';
    params.push(serviceId);
  }
  sql += ' GROUP BY 1 ORDER BY 1';

  const rows = await dataSource.query(sql, params);
  return new Map(rows.map((r) => [r.working_date, Number(r.cnt)]));
}

/**
 * Build the working-day history series for one scope (office-level or service-level).
 *
 * @param {import('typeorm').DataSource} dataSource
 * @param {object} calendarClient - { isWorkingDay(date, officeId): Promise<boolean> }
 * @param {{ officeId: string, serviceId?: string|null, maxWorkingDays?: number }} opts
 * @returns {Promise<{ dates: string[], counts: number[], totalTransactions: number }>}
 */
export async function buildHistorySeries(dataSource, calendarClient, { officeId, serviceId = null, maxWorkingDays = 30 }) {
  const today = manilaDate();
  const fromDate = addCalendarDays(today, -HISTORY_SCAN_DAYS);

  // Query raw daily counts for the whole window
  const dailyCounts = await queryDailyCounts(dataSource, { officeId, serviceId, fromDate, toDate: today });

  // Walk calendar days newest-first to find working days within the scan window
  const workingDays = [];
  for (let i = 0; i < HISTORY_SCAN_DAYS; i++) {
    const d = addCalendarDays(today, -(i + 1)); // start from yesterday (do not include today — it is incomplete)
    const isWD = await calendarClient.isWorkingDay(d, officeId);
    if (isWD) workingDays.push(d);
    if (workingDays.length >= maxWorkingDays) break;
  }

  // Sort ascending (oldest first)
  workingDays.sort();

  const dates = workingDays;
  const counts = workingDays.map((d) => dailyCounts.get(d) ?? 0);
  const totalTransactions = counts.reduce((s, c) => s + c, 0);

  return { dates, counts, totalTransactions };
}

/**
 * Count total transactions for a service (used for the TOO_FEW check).
 * Counts all transactions of that service in this office (no date limit).
 */
export async function countServiceTransactions(dataSource, officeId, serviceId) {
  const rows = await dataSource.query(
    'SELECT COUNT(*)::int AS cnt FROM transactions WHERE office_id = $1 AND service_id = $2',
    [officeId, serviceId],
  );
  return Number(rows[0]?.cnt ?? 0);
}
