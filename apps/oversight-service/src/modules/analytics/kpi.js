import { Errors, ROLES, assertOfficeAccess, isOfficeBound, isUuid, officeFilter, toManilaDate } from 'ccms-shared';
import { resolvePeriod } from './period.js';

// ONE KPI module for reports, dashboards and Insights (Sprint 5 TT3; spec 2.3). computeKpis is a pure function: rows in, figures out.
//
// What counts in a period (all dates are Manila dates):
//   received, backdated, outside hours, not in registry, cancelled, auto-closed   the Manila date of started_at is in the period.
//        Cancelled and auto-closed rows have no ended_at (the feed keeps it empty), so the start date places them.
//   results (on time, late, awaiting, times, early margin, outcomes)             status COMPLETED and the Manila date of
//        ended_at is in the period ("received by start date, results by end date", TEAM DEFAULT, shown on screen).
//   pending now                                                                   every open transaction (IN_PROGRESS or ON_HOLD) now,
//        whatever its start date; it does not depend on the period.
//
// On-time rate = on time / (on time + late), as a percentage with one decimal; null when the divisor is 0 (never 0% or 100%).
// K27: an auto-closed transaction counts as Late inside the rate, tagged "late_auto_closed" so the screen can show how many.
//   The feed does not carry the deadline, so every AUTO_CLOSED row is treated as past its deadline unless the feed ever says
//   is_compliant = true for it (then it stays out of the rate). Operations closes a transaction only after the Charter's maximum
//   working days, which is never before the service's own standard.
// Cancelled transactions are never in the rate. A completed row whose result is still being computed is "awaiting result".
// Early = on time with a negative variance; the margin is how many working minutes before the limit it finished.
//
// groupBy: total (default), office, service or staff. Staff figures attribute starts, cancellations, auto-closes and pending to the
// account that started the transaction and results to the account that ended it (the starter when the ender is unknown).
// Who may ask for what is decided in getKpis (never per-staff figures for the Executive; Office Staff only their own).
export const GROUP_BY = Object.freeze(['total', 'office', 'service', 'staff']);
const NOT_IN_REGISTRY = new Set(['NOT_FOUND', 'EXPIRED']);
const MISS_REASONS = ['OLDER_ALUMNI', 'NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS', 'OTHER'];
const OPEN = new Set(['IN_PROGRESS', 'ON_HOLD']);
// CC050: completed transactions by recorded outcome. Only COMPLETED rows count (never in-progress, held, cancelled or
// auto-closed ones); null is a completion recorded before outcomes existed ("Not recorded"). Matched against these exact
// values, so an unexpected value is never counted as either decision. The disapproval reason is not in the analytics store.
const OUTCOME_BUCKETS = Object.freeze({ GRANTED: 'granted', DISAPPROVED: 'disapproved' });

const oneDecimal = (value) => Math.round(value * 10) / 10;
const average = (list) => (list.length ? oneDecimal(list.reduce((sum, v) => sum + v, 0) / list.length) : null);
function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : oneDecimal((sorted[mid - 1] + sorted[mid]) / 2);
}
// Nearest-rank percentile on a sorted list.
const percentile = (sorted, p) => (sorted.length ? sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] : null);

function makeBucket() {
  return {
    received: 0, backdated: 0, started_outside_hours: 0,
    // CC044 (K5): "Not in registry" = NOT_FOUND or EXPIRED, per office and per reason code.
    not_in_registry: 0,
    not_in_registry_by_reason: Object.fromEntries(MISS_REASONS.map((reason) => [reason, 0])),
    outcomes: { completed: 0, granted: 0, disapproved: 0, not_recorded: 0 },
    cancelled: 0, auto_closed: 0,
    results: { on_time: 0, late: 0, late_auto_closed: 0, late_total: 0, awaiting_result: 0, on_time_rate: null },
    time: { average_minutes: null, median_minutes: null, p90_minutes: null },
    early: { count: 0, average_margin_minutes: null },
    pending: { count: 0, oldest_started_at: null, oldest_age_minutes: null },
    // Raw lists for the statistics; removed by finish().
    _times: [], _margins: [], _oldest: null,
  };
}

function finish(bucket, nowMs) {
  const { _times, _margins, _oldest, ...figures } = bucket;
  const sorted = [..._times].sort((a, b) => a - b);
  const r = figures.results;
  r.late_total = r.late + r.late_auto_closed;
  const divisor = r.on_time + r.late_total;
  r.on_time_rate = divisor > 0 ? oneDecimal((r.on_time / divisor) * 100) : null;
  figures.time = { average_minutes: average(_times), median_minutes: median(sorted), p90_minutes: percentile(sorted, 90) };
  figures.early = { count: _margins.length, average_margin_minutes: average(_margins) };
  if (_oldest !== null) {
    figures.pending.oldest_started_at = new Date(_oldest).toISOString();
    figures.pending.oldest_age_minutes = Math.max(0, Math.floor((nowMs - _oldest) / 60_000));
  }
  return figures;
}

function countStart(bucket, row) {
  bucket.received += 1;
  if (row.is_backdated === true) bucket.backdated += 1;
  else if (row.started_outside_hours === true) bucket.started_outside_hours += 1;
  if (NOT_IN_REGISTRY.has(row.registry_status)) {
    bucket.not_in_registry += 1;
    if (Object.hasOwn(bucket.not_in_registry_by_reason, row.registry_miss_reason)) bucket.not_in_registry_by_reason[row.registry_miss_reason] += 1;
  }
}

/** The outcome bucket of a completed row, or null when the row is not a completion this report counts. */
function outcomeBucket(row) {
  if (row.status !== 'COMPLETED' || !row.ended_at) return null;
  if (row.outcome == null) return 'not_recorded';
  return OUTCOME_BUCKETS[row.outcome] ?? null;
}

function countResult(bucket, row, outcome) {
  bucket.outcomes[outcome] += 1;
  bucket.outcomes.completed += 1;
  const r = bucket.results;
  if (row.is_compliant === true) {
    r.on_time += 1;
    if (Number.isFinite(row.variance_minutes) && row.variance_minutes < 0) bucket._margins.push(-row.variance_minutes);
  } else if (row.is_compliant === false) {
    r.late += 1;
  } else {
    r.awaiting_result += 1; // the result is still being computed: not on time, not late
  }
  if (row.is_compliant !== null && row.is_compliant !== undefined && Number.isFinite(row.elapsed_working_minutes)) bucket._times.push(row.elapsed_working_minutes);
}

const inRange = (day, from, to) => !((from && day < from) || (to && day > to));

/**
 * The figures for the rows given. Pure: no database, no clock except `now` (pending ages).
 *   { officeId, serviceId, from, to, groupBy, now }
 * Returns { totals, groups } where totals and every group hold the figures listed at the top of this file. A group also carries
 * its key: office_id, service_id or user_id (staff account id).
 */
export function computeKpis(rows, { officeId, serviceId, from, to, groupBy = 'total', now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const totals = makeBucket();
  const groups = new Map();
  const keyOf = { office: 'office_id', service: 'service_id', staff: 'user_id' }[groupBy];
  const groupFor = (id) => {
    if (!groups.has(id)) groups.set(id, Object.assign(makeBucket(), { [keyOf]: id }));
    return groups.get(id);
  };
  // Starts, cancellations, auto-closes and pending belong to the starter; results to the ender (the starter when unknown).
  const startKey = (row) => (groupBy === 'staff' ? row.started_by_user_id : row[keyOf]);
  const endKey = (row) => (groupBy === 'staff' ? (row.ended_by_user_id ?? row.started_by_user_id) : row[keyOf]);
  const apply = (fn, key) => {
    fn(totals);
    if (keyOf) fn(groupFor(key));
  };

  for (const row of rows) {
    if (officeId && row.office_id !== officeId) continue;
    if (serviceId && row.service_id !== serviceId) continue;

    if (inRange(toManilaDate(row.started_at), from, to)) {
      apply((b) => countStart(b, row), startKey(row));
      if (row.status === 'CANCELLED') apply((b) => { b.cancelled += 1; }, startKey(row));
      if (row.status === 'AUTO_CLOSED') {
        apply((b) => {
          b.auto_closed += 1;
          if (row.is_compliant !== true) b.results.late_auto_closed += 1; // K27
        }, startKey(row));
      }
    }
    const outcome = outcomeBucket(row);
    if (outcome && inRange(toManilaDate(row.ended_at), from, to)) apply((b) => countResult(b, row, outcome), endKey(row));
    if (OPEN.has(row.status)) {
      const startedMs = new Date(row.started_at).getTime();
      apply((b) => {
        b.pending.count += 1;
        if (b._oldest === null || startedMs < b._oldest) b._oldest = startedMs;
      }, startKey(row));
    }
  }
  return { totals: finish(totals, nowMs), groups: [...groups.values()].map((g) => finish(g, nowMs)) };
}

const COLUMNS = `started_at, ended_at, office_id, service_id, status, outcome, is_compliant, variance_minutes, elapsed_working_minutes,
       is_backdated, started_outside_hours, registry_status, registry_miss_reason, started_by_user_id, ended_by_user_id`;

/**
 * Who may ask for which figures (the server decides; the screen only follows):
 *   Super Admin    every office, every grouping
 *   Executive      every office; groupBy=staff is a 403 (K14)
 *   Office Head    own office; staff figures of that office
 *   Office Staff   own office; staff grouping shows only their own row
 */
export function assertKpiScope(actor, { officeId, groupBy }) {
  if (groupBy === 'staff' && actor.role === ROLES.EXECUTIVE) throw Errors.forbidden('Executives cannot see figures per staff member');
  if (isOfficeBound(actor.role)) assertOfficeAccess(actor, officeId);
}

export async function getKpis(dataSource, actor, query, now = new Date()) {
  const get = (name) => (typeof query?.get === 'function' ? query.get(name) : query?.[name]) || undefined;
  const officeId = get('office_id') || get('officeId') || officeFilter(actor);
  const serviceId = get('service_id') || get('serviceId') || null;
  const groupBy = get('group_by') ?? get('groupBy') ?? 'total';
  if (officeId && !isUuid(officeId)) throw Errors.validation('Choose a valid office.');
  if (serviceId && !isUuid(serviceId)) throw Errors.validation('Choose a valid service.');
  if (!GROUP_BY.includes(groupBy)) throw Errors.validation('Group the figures by total, office, service, or staff.');
  assertKpiScope(actor, { officeId, groupBy });
  const period = resolvePeriod(query, now);

  const rows = await dataSource.query(
    // Started in the period, completed in it, or open now; computeKpis sorts them out.
    `SELECT ${COLUMNS}
     FROM analytics_transactions
     WHERE ((started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
             AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
         OR (status = 'COMPLETED'
             AND ended_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
             AND ended_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
         OR status IN ('IN_PROGRESS', 'ON_HOLD'))
       AND ($3::uuid IS NULL OR office_id = $3::uuid)
       AND ($4::uuid IS NULL OR service_id = $4::uuid)
     ORDER BY office_id, service_id, started_at, transaction_id`,
    [period.from, period.to, officeId, serviceId],
  );
  const figures = computeKpis(rows, { officeId, serviceId, from: period.from, to: period.to, groupBy, now });
  // Office Staff see only their own row of a per-staff table.
  if (groupBy === 'staff' && actor.role === ROLES.OFFICE_STAFF) figures.groups = figures.groups.filter((g) => g.user_id === actor.id);
  return {
    period: period.type, from: period.from, to: period.to, group_by: groupBy,
    basis: 'Received counts by start date; results by end date.',
    generated_at: now.toISOString(),
    ...figures,
  };
}

/** The route's older name; same function. */
export const getStartKpis = getKpis;
