import { Errors, ROLES, isUuid, toManilaDate } from 'ccms-shared';
import { identityBaseUrl } from '../transaction/identity-client.js';

const lower = (v) => typeof v === 'string' ? v.toLowerCase() : v;
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function parsePeopleReport(params, user, now = new Date()) {
  if (![ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(user.role)) throw Errors.forbidden();
  const scope = params.get('scope') ?? (user.role === ROLES.OFFICE_STAFF ? 'person' : 'office');
  const officeId = lower(params.get('office_id') ?? user.officeId);
  const personId = lower(params.get('person_id') ?? (scope === 'person' ? user.id : null));
  const from = params.get('from') ?? toManilaDate(now), to = params.get('to') ?? from;
  if (!['office', 'person', 'all_staff'].includes(scope) || !isUuid(officeId) ||
      (scope === 'person' && !isUuid(personId)) || (scope !== 'person' && params.has('person_id')) ||
      !validDate(from) || !validDate(to) || from > to ||
      [...params.keys()].some((k) => !['scope', 'office_id', 'person_id', 'from', 'to'].includes(k))) {
    throw Errors.validation('Select a valid scope, office, person and date range');
  }
  if (user.role !== ROLES.SUPER_ADMIN && officeId !== lower(user.officeId)) throw Errors.forbidden();
  if (user.role === ROLES.OFFICE_STAFF && (scope !== 'person' || personId !== lower(user.id))) throw Errors.forbidden();
  return { scope, officeId, personId: scope === 'person' ? personId : null, from, to };
}

export async function fetchOfficePeople(officeId, { fetcher = fetch } = {}) {
  try {
    const base = identityBaseUrl();
    if (!base || !process.env.SERVICE_KEY) throw new Error('Identity not configured');
    const r = await fetcher(`${base}/internal/office-accounts?office_id=${encodeURIComponent(officeId)}`, {
      headers: { accept: 'application/json', 'x-service-key': process.env.SERVICE_KEY }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error('Identity unavailable');
    const { items } = await r.json();
    if (!Array.isArray(items) || !items.every((p) => isUuid(p.account_id) && typeof p.full_name === 'string' &&
        [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(p.role))) throw new Error('Invalid roster');
    return items;
  } catch { throw Errors.unavailable('Current office membership could not be verified. Please try again.', 'REPORT_MEMBERSHIP_UNAVAILABLE'); }
}

export const PEOPLE_REPORT_SQL = `WITH scoped AS (
  SELECT t.started_by, t.status, t.is_compliant, t.elapsed_working_minutes, t.held_minutes, r.stars,
    (EXISTS (SELECT 1 FROM seeded_transactions s WHERE s.transaction_id=t.transaction_id)
      OR (t.tracking_no ~ '-9[0-9]{3}$' AND right(t.tracking_no,4) <> '9000')) AS seeded
  FROM transactions t LEFT JOIN service_ratings r ON r.transaction_id=t.transaction_id
  WHERE t.office_id=$1 AND t.started_at >= $2::timestamptz AND t.started_at < $3::timestamptz
    AND ($4::uuid IS NULL OR t.started_by=$4)
), eligible AS (
  SELECT *, CASE WHEN $5::uuid[] IS NULL OR started_by=ANY($5) THEN started_by ELSE NULL END AS person_key
  FROM scoped WHERE NOT seeded
)
SELECT GROUPING(person_key)=1 AS is_total, person_key AS person_id,
  count(*)::int AS handled,
  count(*) FILTER (WHERE status='COMPLETED')::int AS completed,
  count(*) FILTER (WHERE status='COMPLETED' AND is_compliant IS NOT NULL)::int AS measured_completed,
  count(*) FILTER (WHERE status='COMPLETED' AND is_compliant=true)::int AS on_time,
  count(*) FILTER (WHERE status='COMPLETED' AND is_compliant=false)::int AS late,
  count(*) FILTER (WHERE status='AUTO_CLOSED')::int AS auto_closed,
  count(*) FILTER (WHERE status='CANCELLED')::int AS cancelled,
  count(*) FILTER (WHERE status IN ('IN_PROGRESS','ON_HOLD'))::int AS open,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_working_minutes)
    FILTER (WHERE status='COMPLETED' AND elapsed_working_minutes IS NOT NULL) AS median_working_minutes,
  COALESCE(sum(held_minutes),0)::bigint AS paused_minutes,
  count(stars)::int AS rating_count, sum(stars)::int AS rating_sum,
  (SELECT count(*)::int FROM scoped WHERE seeded) AS excluded_seed_count
FROM eligible GROUP BY GROUPING SETS ((),(person_key))`;

function metrics(row = {}) {
  const counts = ['handled', 'completed', 'measured_completed', 'on_time', 'late', 'auto_closed', 'cancelled', 'open', 'paused_minutes', 'rating_count'];
  const result = Object.fromEntries(counts.map((k) => [k, Number(row[k] ?? 0)]));
  return { ...result, on_time_percent: result.measured_completed ? Math.round(10000 * result.on_time / result.measured_completed) / 100 : null,
    median_working_minutes: row.median_working_minutes == null ? null : Number(row.median_working_minutes),
    rating_average: result.rating_count ? Number(row.rating_sum) / result.rating_count : null, linked_complaints: null };
}

// BE Dev 1 source data. Oversight owns composing, publishing and freezing the final reports.
export async function readPeopleReport(db, user, params, { now = new Date(), roster = fetchOfficePeople } = {}) {
  const q = parsePeopleReport(params, user, now);
  const people = user.role === ROLES.OFFICE_STAFF ? [{ account_id: user.id, full_name: user.fullName ?? null }] : await roster(q.officeId);
  const names = new Map(people.map((p) => [lower(p.account_id), p.full_name]));
  if (user.role === ROLES.OFFICE_HEAD && q.scope === 'person' && q.personId !== lower(user.id) && !names.has(q.personId)) throw Errors.forbidden();
  if (user.role === ROLES.OFFICE_HEAD && !names.has(lower(user.id))) names.set(lower(user.id), user.fullName ?? null);
  const allowed = user.role === ROLES.OFFICE_HEAD ? [...names.keys()] : null;
  const end = new Date(`${q.to}T00:00:00+08:00`); end.setUTCDate(end.getUTCDate() + 1);
  const rows = await db.query(PEOPLE_REPORT_SQL, [q.officeId, `${q.from}T00:00:00+08:00`, end.toISOString(), q.personId, allowed]);
  const total = rows.find((r) => r.is_total) ?? {};
  const items = rows.filter((r) => !r.is_total).map((r) => ({ person_id: r.person_id,
    person_name: r.person_id ? names.get(lower(r.person_id)) ?? null : 'Other or former handlers', ...metrics(r) }));
  if (q.scope === 'all_staff') for (const [id, name] of names) {
    if (!items.some((p) => lower(p.person_id) === id)) items.push({ person_id: id, person_name: name, ...metrics() });
  }
  if (q.scope === 'person' && !items.length) items.push({ person_id: q.personId, person_name: names.get(q.personId) ?? null, ...metrics() });
  items.sort((a, b) => String(a.person_name ?? '').localeCompare(String(b.person_name ?? '')) || String(a.person_id ?? '').localeCompare(String(b.person_id ?? '')));
  return { scope: q.scope, office_id: q.officeId, person_id: q.personId, from: q.from, to: q.to, generated_at: now.toISOString(),
    totals: metrics(total), items: q.scope === 'office' ? [] : items, excluded_seed_count: Number(total.excluded_seed_count ?? 0),
    note: 'Seeded rows are excluded from these figures (K17).',
    basis: 'Transactions received in the selected Manila start-date period, attributed to the person who started them. Paused minutes are completed holds recorded so far.',
    attribution: { person: 'started_by', ratings: 'Service ratings linked to handled transactions; not a rating of the staff member.',
      complaints: 'Unavailable here: complaint linkage and stored report composition belong to Oversight (BE Dev 2).' } };
}
