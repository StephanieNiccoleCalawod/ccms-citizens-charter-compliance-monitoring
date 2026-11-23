// CC054 / S8-50: same usable population, interpolated quartiles and strict fence as Charter.
export function slowCaseIds(rows) {
  const usable = rows.filter((r) => r.status === 'COMPLETED' && Number.isInteger(r.elapsed_working_minutes) &&
    Number.isInteger(r.variance_minutes) && typeof r.is_compliant === 'boolean');
  const ids = new Set();
  for (const group of Map.groupBy(usable, (r) => `${r.office_id}|${r.service_id}`).values()) {
    if (group.length < 20) continue;
    const times = group.map((r) => r.elapsed_working_minutes).sort((a, b) => a - b);
    const q = (p) => {
      const at = (times.length - 1) * p;
      return times[Math.floor(at)] + (times[Math.ceil(at)] - times[Math.floor(at)]) * (at - Math.floor(at));
    };
    const q1 = q(0.25), q3 = q(0.75);
    for (const row of group) if (row.elapsed_working_minutes > q3 + 3 * (q3 - q1)) ids.add(row.transaction_id);
  }
  return ids;
}

// $1 office; $3 as-of instant. Population includes all usable completions available by that instant.
export const SLOW_CASE_CTE = `WITH usable AS (
  SELECT transaction_id, office_id, service_id, elapsed_working_minutes
  FROM transactions WHERE office_id = $1 AND status = 'COMPLETED' AND ended_at <= $3::timestamptz
    AND elapsed_working_minutes IS NOT NULL AND variance_minutes IS NOT NULL AND is_compliant IS NOT NULL
), fences AS (
  SELECT office_id, service_id,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY elapsed_working_minutes) AS q1,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY elapsed_working_minutes) AS q3
  FROM usable GROUP BY office_id, service_id HAVING count(*) >= 20
), slow AS (
  SELECT u.transaction_id AS excluded_id FROM usable u JOIN fences f USING (office_id, service_id)
  WHERE u.elapsed_working_minutes > f.q3 + 3 * (f.q3 - f.q1)
)`;
