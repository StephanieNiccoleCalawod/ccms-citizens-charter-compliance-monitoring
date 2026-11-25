// S8 flags 4 and 6 of the unusual-case table. Pure functions: analytics rows in, findings out. (Flag 5, low service rating, is read from Operations: ratings live there.)
//   HOLD_LONG       one request was on hold for more than one working day in total (held_minutes are working minutes).
//   MANY_CANCELLED  an office's cancelled + auto-closed requests on a day are above its usual (Q3 + 3 x IQR of its own days), only when
//                   the office has at least 20 working days of history. Days without any request are not working days.
import { toManilaDate } from 'ccms-shared';

export const WORKING_DAY_MINUTES = 480; // 8 working hours; held_minutes are working minutes
export const MIN_WORKING_DAYS = 20;
export const IQR_FACTOR = 3;
export const FLAG_HOLD_LONG = 'HOLD_LONG';
export const FLAG_MANY_CANCELLED = 'MANY_CANCELLED';

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Requests held more than one working day. Longest first. */
export function holdFlags(rows, { dayMinutes = WORKING_DAY_MINUTES } = {}) {
  return rows
    .filter((r) => Number.isInteger(r.held_minutes) && r.held_minutes > dayMinutes)
    .map((r) => ({ flag: FLAG_HOLD_LONG, transaction_id: r.transaction_id, tracking_no: r.tracking_no, office_id: r.office_id, service_id: r.service_id, service_code: r.service_code,
      held_minutes: r.held_minutes, limit_minutes: dayMinutes }))
    .sort((a, b) => b.held_minutes - a.held_minutes || String(a.tracking_no).localeCompare(String(b.tracking_no)));
}

/**
 * Days in [from, to] on which an office's cancelled + auto-closed count is above its usual. `rows` are all requests started in a
 * window that includes earlier days (the usual comes from every working day of the office in the rows, the period included).
 */
export function cancellationFlags(rows, { from, to }) {
  const byOffice = Map.groupBy(rows.filter((r) => r.started_at), (r) => String(r.office_id).toLowerCase());
  const out = [];
  for (const [officeId, group] of byOffice) {
    const perDay = new Map();
    for (const r of group) {
      const day = toManilaDate(r.started_at);
      const d = perDay.get(day) ?? { started: 0, cancelled: 0 };
      d.started += 1;
      if (r.status === 'CANCELLED' || r.status === 'AUTO_CLOSED') d.cancelled += 1;
      perDay.set(day, d);
    }
    if (perDay.size < MIN_WORKING_DAYS) continue;
    const sorted = [...perDay.values()].map((d) => d.cancelled).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25); const q3 = quantile(sorted, 0.75);
    const fence = q3 + IQR_FACTOR * (q3 - q1);
    const days = [...perDay.entries()].filter(([day, d]) => day >= from && day <= to && d.cancelled > fence && d.cancelled >= 1)
      .map(([day, d]) => ({ day, cancelled: d.cancelled, started: d.started })).sort((a, b) => a.day.localeCompare(b.day));
    if (days.length) out.push({ flag: FLAG_MANY_CANCELLED, office_id: officeId, usual_max: Math.floor(fence), working_days: perDay.size, days });
  }
  return out.sort((a, b) => b.days.length - a.days.length || a.office_id.localeCompare(b.office_id));
}
