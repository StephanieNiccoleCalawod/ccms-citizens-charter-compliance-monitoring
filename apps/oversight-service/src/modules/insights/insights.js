import { ROLES, Errors, calculation, isUuid, officeFilter, assertOfficeAccess, isOfficeBound, toManilaDate } from 'ccms-shared';
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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function recentMonths(now = new Date(), count = 6) {
  const anchor = toManilaDate(now);
  const year = Number(anchor.slice(0, 4));
  const monthIndex = Number(anchor.slice(5, 7)) - 1;
  const out = [];
  for (let offset = -(count - 1); offset <= 0; offset += 1) {
    const d = new Date(Date.UTC(year, monthIndex + offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    out.push({ key, label: `${MONTH_LABELS[m]} ${y}`, from: `${key}-01`, to });
  }
  return out;
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

/**
 * The on-time figures behind the six-month trend and the compliance heatmap, counted by the database instead of pulling every row
 * of the six months into Node: one line per office and Manila month with the counts computeKpis would reach (same rules: a
 * completed row with a recordable outcome counts by the Manila month of ended_at; an auto-closed row not marked on time counts as
 * late by the Manila month of started_at; any row started in the window puts its office on the heatmap).
 */
async function loadTrendCounts(db, { officeId, from, to }) {
  return rowsOf(await db.query(
    `SELECT office_id, month, sum(on_time)::int AS on_time, sum(late)::int AS late, sum(late_auto)::int AS late_auto
       FROM (
         SELECT office_id, to_char((started_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM') AS month,
                0 AS on_time, 0 AS late,
                CASE WHEN status = 'AUTO_CLOSED' AND is_compliant IS DISTINCT FROM true THEN 1 ELSE 0 END AS late_auto
           FROM analytics_transactions
          WHERE started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila') AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
            AND ($3::uuid IS NULL OR office_id = $3::uuid)
         UNION ALL
         SELECT office_id, to_char((ended_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM') AS month,
                CASE WHEN is_compliant IS TRUE THEN 1 ELSE 0 END, CASE WHEN is_compliant IS FALSE THEN 1 ELSE 0 END, 0
           FROM analytics_transactions
          WHERE status = 'COMPLETED' AND ended_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila') AND ended_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
            AND (outcome IS NULL OR outcome IN ('GRANTED', 'DISAPPROVED'))
            AND ($3::uuid IS NULL OR office_id = $3::uuid)
       ) events
      GROUP BY office_id, month`,
    [from, to, officeId],
  ));
}

const oneDecimal = (value) => Math.round(value * 10) / 10;

function buildMonthlySeries(trendCounts, months, { officeId, now }) {
  const officeIds = new Set(officeId ? [officeId] : []);
  const perMonth = new Map(months.map((m) => [m.key, { on_time: 0, late_total: 0, byOffice: new Map() }]));
  for (const row of trendCounts) {
    const bucket = perMonth.get(row.month);
    if (!bucket) continue;
    officeIds.add(row.office_id);
    const lateTotal = row.late + row.late_auto;
    bucket.on_time += row.on_time;
    bucket.late_total += lateTotal;
    bucket.byOffice.set(row.office_id, { on_time: row.on_time, late_total: lateTotal });
  }
  // On-time rate = on time / (on time + late), one decimal; null when the divisor is 0 (the same rule as the KPI module).
  const rateOf = ({ on_time: onTime, late_total: lateTotal }) => (onTime + lateTotal > 0 ? oneDecimal((onTime / (onTime + lateTotal)) * 100) : null);
  const monthData = months.map((m) => {
    const bucket = perMonth.get(m.key);
    const byOffice = new Map([...bucket.byOffice].map(([id, counts]) => [id, rateOf(counts)]));
    return { key: m.key, label: m.label, rate: rateOf(bucket), byOffice };
  });
  return {
    trend: monthData.map((m) => ({ period: m.key, label: m.label, value: m.rate })),
    compliance_heatmap: {
      periods: monthData.map(({ key, label }) => ({ key, label })),
      rows: [...officeIds].sort().map((id) => ({
        office_id: id,
        cells: monthData.map((m) => ({ period: m.key, value: m.byOffice.get(id) ?? null })),
      })),
    },
    monthlyCalculations: months.map((m) => ({ period: m.key,
      total: monthlyCalculation(perMonth.get(m.key), m, now),
      offices: [...officeIds].sort().map((id) => ({ office_id: id,
        ...monthlyCalculation(perMonth.get(m.key).byOffice.get(id) ?? { on_time: 0, late_total: 0 }, m, now) })),
    })),
  };
}

function monthlyCalculation(counts, period, now) {
  return calculation({ shows: 'The percentage of judged requests finished on time in this month.',
    steps: ['Count on-time and late completions by Manila end date; include auto-closed requests as late by start date unless marked on time.',
      'Divide on-time requests by the total judged count, multiply by 100 and round to one decimal.'],
    count: counts.on_time + counts.late_total, from: period.from, to: period.to, at: now,
    source: 'analytics_transactions', basis: 'Completed results by end date; late auto-closures by start date in Asia/Manila.',
    method: 'on_time / (on_time + late + late_auto_closed) * 100' });
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

function canOpenInsightTransaction(actor, row) {
  if (!row) return false;
  if (actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.EXECUTIVE) return true;
  if (actor.role === ROLES.OFFICE_HEAD) {
    return Boolean(actor.officeId) && String(row.office_id).toLowerCase() === String(actor.officeId).toLowerCase();
  }
  if (actor.role === ROLES.OFFICE_STAFF) {
    return Boolean(row.started_by_user_id) && String(row.started_by_user_id).toLowerCase() === String(actor.id).toLowerCase();
  }
  return false;
}

export async function getInsights(db, actor, query, now = new Date()) {
  const { officeId } = scopeOffice(actor, query);
  const period = resolvePeriod(query, now);
  const prev = previousPeriod(period);
  const months = recentMonths(now, 6);
  const [rows, trendCounts] = await Promise.all([
    loadRows(db, { officeId, from: prev.from, to: period.to }),
    loadTrendCounts(db, { officeId, from: months[0].from, to: months.at(-1).to }),
  ]);
  const opts = { officeId: officeId ?? undefined, now };
  const current = computeKpis(rows, { ...opts, from: period.from, to: period.to, groupBy: 'office' });
  const before = computeKpis(rows, { ...opts, from: prev.from, to: prev.to });
  const byService = computeKpis(rows, { ...opts, from: period.from, to: period.to, groupBy: 'service' });
  const today = toManilaDate(now);
  const periodRows = rows.filter((r) => (r.started_at && inRange(toManilaDate(r.started_at), period.from, period.to)) || r.status === 'IN_PROGRESS' || r.status === 'ON_HOLD' || (r.ended_at && inRange(toManilaDate(r.ended_at), period.from, period.to)));
  const heatmap = buildHeatmap(periodRows, period);
  const { trend, compliance_heatmap, monthlyCalculations } = buildMonthlySeries(trendCounts, months, { officeId, now });
  const rawCharter = charterCheck(completedIn(periodRows, period), { ...period, now });
  const rowById = new Map(periodRows.map((r) => [r.transaction_id, r]));
  const charter = {
    ...rawCharter,
    unusual: rawCharter.unusual.map((u) => ({ ...u, can_open: canOpenInsightTransaction(actor, rowById.get(u.transaction_id)) })),
  };
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
    previous_results: before.totals.results.on_time + before.totals.results.late_total,
    trend,
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
    calculations: { ...totals.calculations,
      previous_on_time_rate: before.totals.calculations.on_time_rate,
      charter_summary: rawCharter.calculations.charter,
      service_late_rates: calculation({ shows: 'The percentage of completed requests that finished late in each office and service.',
        steps: ['Group completions with a boolean compliance result by office and service.', 'Divide each group’s late count by its completed count; mark groups below the minimum sample as too few.'],
        count: heatmap.reduce((sum, c) => sum + c.completed, 0), from: period.from, to: period.to, at: now,
        source: 'analytics_transactions', basis: 'Manila completion date; only computed results count.',
        method: 'per-cell late / completed * 100', parameters: { minimum_cell_completed: MIN_CELL_COMPLETED } }),
      monthly: monthlyCalculations,
      services: byService.groups.map((g) => ({ service_id: g.service_id, calculations: g.calculations })),
      offices: current.groups.map((g) => ({ office_id: g.office_id, calculations: g.calculations })),
      received_today: calculation({ shows: 'Requests received today within the loaded dashboard records.', steps: ['Use the selected office records loaded for the selected and preceding periods, plus currently open requests.', 'Count loaded requests started on today’s Manila date.'],
        count: pulse.received_today, from: today, to: today, at: now, basis: 'Manila start date within loaded dashboard records.', source: 'analytics_transactions', method: 'count', parameters: { loaded_from: prev.from, loaded_to: period.to } }),
      completed_today: calculation({ shows: 'Requests completed today within the loaded dashboard records.', steps: ['Use the selected office records loaded for the selected and preceding periods.', 'Count loaded completed requests whose end date is today in Manila.'],
        count: pulse.completed_today, from: today, to: today, at: now, basis: 'Manila end date within loaded dashboard records.', source: 'analytics_transactions', method: 'count', parameters: { loaded_from: prev.from, loaded_to: period.to } }),
      heatmap: heatmap.map((c) => ({ office_id: c.office_id, service_id: c.service_id,
        ...calculation({ shows: 'The late percentage for this office and service.', steps: ['Count completions in the period with a boolean compliance result.', 'Divide late completions by this count and multiply by 100.'],
          count: c.completed, from: period.from, to: period.to, at: now, basis: 'Manila end date; completed results only.',
          source: 'analytics_transactions', method: 'late / completed * 100' }) })),
      charter: rawCharter.services.map((s) => ({ office_id: s.office_id, service_id: s.service_id, ...s.calculations.charter })),
    },
    scope: officeId ? { kind: 'office', office_id: officeId } : { kind: 'campus' },
    pulse, heatmap, compliance_heatmap, min_cell_completed: MIN_CELL_COMPLETED, sentences, max_sentences: MAX_SENTENCES, charter,
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
    generated_at: now.toISOString(),
    calculations: { weekly: calculation({ shows: 'The weekly late percentage for this office and service.',
      steps: ['Select completed requests with a computed compliance result in the selected period.', 'Group by Monday of the Manila completion week; divide late results by the number completed in each week.'],
      count: done.length, from: period.from, to: period.to, at: now, basis: 'Manila end date, clipped to selected dates even for partial weeks.',
      source: 'analytics_transactions', method: 'late / completed * 100' }),
      late_transactions: calculation({ shows: 'The 50 most recently completed late requests in this selection.',
        steps: ['Select completed late results in the office, service and date filters.', 'Sort by completion time, newest first, and return up to 50.'],
        count: done.filter((r) => !r.is_compliant).length, from: period.from, to: period.to, at: now,
        basis: 'Manila end date; record_count is the total matching count before the 50-row limit.', source: 'analytics_transactions', method: 'filter and newest 50' }) },
    weekly: [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)).map((w) => ({ ...w, late_rate: rate(w.late, w.completed) })),
    late_transactions: done.filter((r) => r.is_compliant === false)
      .sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)))
      .slice(0, 50).map((r) => ({ transaction_id: r.transaction_id, tracking_no: r.tracking_no, ended_at: r.ended_at, variance_minutes: r.variance_minutes })),
  };
}

export { ROLES };
