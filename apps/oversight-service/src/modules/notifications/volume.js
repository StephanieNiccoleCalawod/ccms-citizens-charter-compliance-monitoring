import { toManilaDate } from 'ccms-shared';

// S8-50 (b): unusually many requests in a day. A day is unusual when the office's count for it is above Q3 + 3 x IQR of the office's
// own earlier days (interpolated quartiles, the same fence the slow-case rule uses). Days with no request are not counted as working
// days. With fewer than MIN_DAYS earlier days, or fewer than MIN_COUNT requests today, nothing is said.
export const MIN_DAYS = 20;
export const MIN_COUNT = 5;
export const HISTORY_DAYS = 90;
export const IQR_FACTOR = 3;

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** { unusual, today, usual_max } for one office. `earlier` is the daily counts of the days before today. */
export function volumeCheck(earlier, today) {
  if (earlier.length < MIN_DAYS || today < MIN_COUNT) return { unusual: false, today, usual_max: null };
  const sorted = [...earlier].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25); const q3 = quantile(sorted, 0.75);
  const fence = q3 + IQR_FACTOR * (q3 - q1);
  return { unusual: today > fence, today, usual_max: Math.floor(fence) };
}

/** Notices for the offices in `rows` ({ office_id, day, n }); today is a Manila date. One notice per office per day. */
export function volumeNotices(rows, { now = new Date() } = {}) {
  const today = toManilaDate(now);
  const byOffice = Map.groupBy(rows, (r) => String(r.office_id).toLowerCase());
  const out = [];
  for (const [officeId, list] of byOffice) {
    const todayCount = list.filter((r) => r.day === today).reduce((sum, r) => sum + Number(r.n), 0);
    const earlier = list.filter((r) => r.day < today).map((r) => Number(r.n));
    const check = volumeCheck(earlier, todayCount);
    if (!check.unusual) continue;
    out.push({ key: `volume:${officeId}:${today}`, kind: 'VOLUME', office_id: officeId, href: '/', at: now.toISOString(),
      text: `Many more requests than usual today: ${check.today} so far, when up to about ${check.usual_max} is usual. Consider opening another counter or moving staff to the busy service.` });
  }
  return out;
}

export async function readVolumeNotices(db, { officeId, now = new Date() }) {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const result = await db.query(
    `SELECT office_id, to_char((started_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM analytics_transactions WHERE ($1::uuid IS NULL OR office_id = $1::uuid) AND started_at >= $2 GROUP BY 1, 2`, [officeId, since]);
  return volumeNotices(Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result, { now });
}
