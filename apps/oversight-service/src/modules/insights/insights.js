import { ROLES, Errors, isUuid, officeFilter, assertOfficeAccess, isOfficeBound, toManilaDate } from 'ccms-shared';
import { computeKpis } from '../analytics/kpi.js';
import { addDays, resolvePeriod } from '../analytics/period.js';
import { charterCheck } from './charter.js';
import { MAX_SENTENCES, MIN_CELL_COMPLETED, buildSentences } from './sentences.js';

// CC053: the numbers behind the Insights page, from the analytics store only (one KPI module, TT3). What lives in Operations
// (open transactions at High late risk, the request forecast, the late-risk model and its accuracy) is read by the screen from
// Operations directly; Oversight has no copy of it. Access: Office Head and Office Staff their own office; Executive and Super
// Admin every office; nothing here is per staff member.
const COLUMNS = `transaction_id, tracking_no, office_id, service_id, service_code, status, outcome, is_compliant, variance_minutes, elapsed_working_minutes,
       started_at, ended_at, is_backdated, started_outside_hours, registry_status, registry_miss_reason, started_by_user_id, ended_by_user_id, queue_wait_minutes`;

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

export function previousPeriod({ from, to }) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(days - 1)), to: prevTo };
}

function scopeOffice(actor, query) {
  const get = (name) => (typeof query?.get === 'function' ? query.get(name) : query?.[name]) || undefined;
  const officeId = get('office_id') || get('officeId') || officeFilter(actor);
  if (officeId && !isUuid(officeId)) throw Errors.validation('Choose a valid office.', { office_id: 'Choose a valid office.' });
  if (isOfficeBound(actor.role)) assertOfficeAccess(actor, officeId);
  return { officeId: officeId ?? null, get };
}

async function loadRows(db, { officeId, from, to }) {
  return rowsOf(await db.query(
    `SELECT ${COLUMNS} FROM analytics_transactions
      WHERE ((started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila') AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
          OR (status = 'COMPLETED' AND ended_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila') AND ended_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
          OR status IN ('IN_PROGRESS', 'ON_HOLD'))
        AND ($3::uuid IS NULL OR office_id = $3::uuid)
      ORDER BY office_id, service_id, started_at, transaction_id`,
    [from, to, officeId],
  ));
}

const inRange = (date, from, to) => date >= from && date <= to;
const completedIn = (rows, { from, to }) => rows.filter((r) => r.status === 'COMPLETED' && r.ended_at && inRange(toManilaDate(r.ended_at), from, to));
const rate = (late, n) => (n > 0 ? Math.round((late / n) * 1000) / 10 : null);

/** office x service late rate. n = on time + late (the on-time rate divisor), so a cell agrees with the KPI figures. */
export function buildHeatmap(rows, period) {
  const cells = new Map();
  for (const r of completedIn(rows, period)) {
    if (typeof r.is_compliant !== 'boolean') continue;
    const key = `${r.office_id}|${r.service_id}`;
    const c = cells.get(key) ?? { office_id: r.office_id, service_id: r.service_id, service_code: r.service_code, completed: 0, late: 0 };
    c.completed += 1;
    if (r.is_compliant === false) c.late += 1;
    cells.set(key, c);
  }
  return [...cells.values()].map((c) => ({ ...c, late_rate: rate(c.late, c.completed), too_few: c.completed < MIN_CELL_COMPLETED }))
    .sort((a, b) => String(a.office_id).localeCompare(String(b.office_id)) || String(a.service_code).localeCompare(String(b.service_code)));
}

/** Per office: completed and late in the first and the last third of the period (by the Manila date of ended_at). Spec 3.3, sentence 3. */
export function buildOfficeTrend(rows, { from, to }) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const offices = new Map();
  for (const r of completedIn(rows, { from, to })) {
    if (typeof r.is_compliant !== 'boolean') continue;
    const index = Math.round((Date.parse(`${toManilaDate(r.ended_at)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const o = offices.get(r.office_id) ?? { office_id: r.office_id, completed: 0, first_completed: 0, first_late: 0, last_completed: 0, last_late: 0 };
    o.completed += 1;
    if (index < days / 3) { o.first_completed += 1; if (!r.is_compliant) o.first_late += 1; }
    else if (index >= (2 * days) / 3) { o.last_completed += 1; if (!r.is_compliant) o.last_late += 1; }
    offices.set(r.office_id, o);
  }
  return [...offices.values()];
}

export async function getInsights(db, actor, query, now = new Date()) {
  const { officeId } = scopeOffice(actor, query);
  const period = resolvePeriod(query, now);
  const prev = previousPeriod(period);
  const rows = await loadRows(db, { officeId, from: prev.from, to: period.to });
  const opts = { officeId: officeId ?? undefined, now };
  const current = computeKpis(rows, { ...opts, from: period.from, to: period.to, groupBy: 'office' });
  const before = computeKpis(rows, { ...opts, from: prev.from, to: prev.to });
  const byService = computeKpis(rows, { ...opts, from: period.from, to: period.to, groupBy: 'service' });
  const today = toManilaDate(now);
  const periodRows = rows.filter((r) => (r.started_at && inRange(toManilaDate(r.started_at), period.from, period.to)) || r.status === 'IN_PROGRESS' || r.status === 'ON_HOLD' || (r.ended_at && inRange(toManilaDate(r.ended_at), period.from, period.to)));
  const heatmap = buildHeatmap(periodRows, period);
  const charter = charterCheck(completedIn(periodRows, period));
  const codeOf = new Map(rows.map((r) => [r.service_id, r.service_code]));
  const totals = current.totals;

  const pulse = {
    open_now: totals.pending.count,
    oldest_open_age_minutes: totals.pending.oldest_age_minutes,
    completed_today: rows.filter((r) => r.status === 'COMPLETED' && r.ended_at && toManilaDate(r.ended_at) === today).length,
    received_today: rows.filter((r) => r.started_at && toManilaDate(r.started_at) === today).length,
    on_time_rate: totals.results.on_time_rate,
    previous_on_time_rate: before.totals.results.on_time_rate,
    results: totals.results.on_time + totals.results.late_total,
  };
  const sentences = buildSentences({
    period: period.type,
    services: byService.groups.map((g) => ({ service_id: g.service_id, service_code: codeOf.get(g.service_id) ?? null, completed: g.results.on_time + g.results.late_total, late: g.results.late_total })),
    officeTrend: buildOfficeTrend(periodRows, period),
    charter,
  });
  const completedAll = rows.filter((r) => r.status === 'COMPLETED');
  return {
    period: period.type, from: period.from, to: period.to, previous: prev, generated_at: now.toISOString(),
    scope: officeId ? { kind: 'office', office_id: officeId } : { kind: 'campus' },
    pulse, heatmap, min_cell_completed: MIN_CELL_COMPLETED, sentences, max_sentences: MAX_SENTENCES, charter,
    about: {
      rows_in_store: rows.length, completed_rows: completedAll.length, late_cases: completedAll.filter((r) => r.is_compliant === false).length,
      earliest_started_at: rows.reduce((min, r) => (!min || r.started_at < min ? r.started_at : min), null),
    },
  };
}

/** The click on a heatmap cell: the weekly late rate of that office and service, and the late transactions of the period. */
export async function getCell(db, actor, query, now = new Date()) {
  const { officeId, get } = scopeOffice(actor, query);
  const serviceId = get('service_id');
  if (!officeId || !isUuid(officeId)) throw Errors.validation('Choose an office.', { office_id: 'Choose an office.' });
  if (!serviceId || !isUuid(serviceId)) throw Errors.validation('Choose a service.', { service_id: 'Choose a service.' });
  const period = resolvePeriod(query, now);
  const rows = (await loadRows(db, { officeId, from: period.from, to: period.to })).filter((r) => r.service_id === serviceId);
  const done = completedIn(rows, period).filter((r) => typeof r.is_compliant === 'boolean');
  const weeks = new Map();
  for (const r of done) {
    const day = toManilaDate(r.ended_at);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const monday = addDays(day, -((weekday + 6) % 7));
    const w = weeks.get(monday) ?? { week_start: monday, completed: 0, late: 0 };
    w.completed += 1;
    if (r.is_compliant === false) w.late += 1;
    weeks.set(monday, w);
  }
  return {
    from: period.from, to: period.to, office_id: officeId, service_id: serviceId, service_code: rows[0]?.service_code ?? null,
    weekly: [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)).map((w) => ({ ...w, late_rate: rate(w.late, w.completed) })),
    late_transactions: done.filter((r) => r.is_compliant === false)
      .sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)))
      .slice(0, 50).map((r) => ({ transaction_id: r.transaction_id, tracking_no: r.tracking_no, ended_at: r.ended_at, variance_minutes: r.variance_minutes })),
  };
}

export { ROLES };
