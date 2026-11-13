// CC054 (Tier 2): the Charter reality check and unusual cases, computed from the analytics store. Pure functions: rows in, findings out.
//
// Per service, over the completed transactions whose result was computed in the period:
//   limit      the working-minute limit the transaction was judged against. The store keeps no limit column, but every row carries
//              elapsed_working_minutes and variance_minutes (= elapsed - limit), so limit = elapsed - variance (exact, no calendar guess).
//   median, p90, late rate = late / completed.
//   flags      "limit often missed"               more than 20% late
//              "limit far longer than real work"  90th percentile below 25% of the limit
//              "not enough data"                  fewer than 20 completed (no flag is given)
//   unusual    elapsed above Q3 + 3 x IQR of the service, only when the service has at least 20 completed.
// Thresholds from the backlog (CC054, B-10, B-11). Percentiles are nearest-rank, like the KPI module.
export const MIN_COMPLETED = 20;
export const LATE_RATE_FLAG = 0.20;
export const P90_SHARE_FLAG = 0.25;
export const OUTLIER_IQR_FACTOR = 3;

export const FLAG_OFTEN_MISSED = 'LIMIT_OFTEN_MISSED';
export const FLAG_FAR_LONGER = 'LIMIT_FAR_LONGER';
export const FLAG_NOT_ENOUGH = 'NOT_ENOUGH_DATA';

const oneDecimal = (v) => Math.round(v * 10) / 10;
const percentile = (sorted, p) => (sorted.length ? sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] : null);
function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
// Q1 and Q3 by linear interpolation (the usual quartile definition); the IQR fence does not need nearest-rank.
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const usable = (row) => row.status === 'COMPLETED' && Number.isInteger(row.elapsed_working_minutes) && Number.isInteger(row.variance_minutes) && typeof row.is_compliant === 'boolean';

/** Rows must already be the completed-in-period rows of the people the caller may see. */
export function charterCheck(rows) {
  const byService = Map.groupBy(rows.filter(usable), (row) => `${row.office_id}|${row.service_id}`);
  const services = [];
  const unusual = [];
  for (const group of byService.values()) {
    const { office_id: officeId, service_id: serviceId, service_code: serviceCode } = group[0];
    const completed = group.length;
    const late = group.filter((r) => r.is_compliant === false).length;
    const times = group.map((r) => r.elapsed_working_minutes).sort((a, b) => a - b);
    const limits = group.map((r) => r.elapsed_working_minutes - r.variance_minutes).sort((a, b) => a - b);
    const limit = median(limits);
    const entry = {
      office_id: officeId, service_id: serviceId, service_code: serviceCode, completed, late,
      late_rate: oneDecimal((late / completed) * 100), limit_minutes: limit,
      median_minutes: oneDecimal(median(times)), p90_minutes: percentile(times, 90),
      p90_share_of_limit: limit > 0 ? oneDecimal((percentile(times, 90) / limit) * 100) : null,
      flags: [],
    };
    if (completed < MIN_COMPLETED) {
      entry.flags.push(FLAG_NOT_ENOUGH);
    } else {
      if (late / completed > LATE_RATE_FLAG) entry.flags.push(FLAG_OFTEN_MISSED);
      if (limit > 0 && percentile(times, 90) < limit * P90_SHARE_FLAG) entry.flags.push(FLAG_FAR_LONGER);
      const q1 = quantile(times, 0.25);
      const q3 = quantile(times, 0.75);
      const fence = q3 + OUTLIER_IQR_FACTOR * (q3 - q1);
      for (const r of group) {
        if (r.elapsed_working_minutes > fence) {
          unusual.push({
            transaction_id: r.transaction_id, tracking_no: r.tracking_no, office_id: officeId, service_id: serviceId, service_code: serviceCode,
            elapsed_minutes: r.elapsed_working_minutes, limit_minutes: limit, fence_minutes: oneDecimal(fence),
            ended_at: r.ended_at, is_compliant: r.is_compliant,
          });
        }
      }
    }
    services.push(entry);
  }
  services.sort((a, b) => b.late_rate - a.late_rate || b.completed - a.completed || String(a.service_code).localeCompare(String(b.service_code)));
  unusual.sort((a, b) => b.elapsed_minutes / (b.fence_minutes || 1) - a.elapsed_minutes / (a.fence_minutes || 1) || String(a.tracking_no).localeCompare(String(b.tracking_no)));
  return { thresholds: { min_completed: MIN_COMPLETED, late_rate_percent: LATE_RATE_FLAG * 100, p90_share_percent: P90_SHARE_FLAG * 100, iqr_factor: OUTLIER_IQR_FACTOR }, services, unusual };
}
