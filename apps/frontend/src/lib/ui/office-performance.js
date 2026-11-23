// View model for the Office Performance tab (Needs Immediate Attention, Office Performance, Services by Office).
// Pure functions over data the Dashboard already loads: overview.heatmap (office x service completed/late counts) and
// overview.charter.services (Charter limit and 90th percentile per office and service). No figure is invented here, and the
// late-rate thresholds are the existing ones (classifyServiceCell: more than 20% is delayed, more than 10% needs attention).
import { MIN_CELL_COMPLETED, classifyServiceCell, minutesText } from './insights.js';

export const PERFORMANCE_STATUS = Object.freeze({
  delayed: { key: 'delayed', label: 'Delayed', badge: 'danger', rank: 0 },
  attention: { key: 'attention', label: 'Needs Attention', badge: 'warning', rank: 1 },
  on_time: { key: 'on_time', label: 'On Time', badge: 'success', rank: 2 },
  too_few: { key: 'too_few', label: 'Too few to judge', badge: 'neutral', rank: 3 },
  no_data: { key: 'no_data', label: 'No transactions', badge: 'neutral', rank: 4 },
});

const RISK_TO_STATUS = { high: 'delayed', watch: 'attention', on_track: 'on_time', too_few: 'too_few' };
const key = (office, service) => `${String(office ?? '').toLowerCase()}|${String(service ?? '').toLowerCase()}`;
const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : `${Number(n)}%`);

/** On-time share of a completed count (whole numbers, never negative). */
export const onTimeCount = (completed, late) => Math.max(0, (Number(completed) || 0) - (Number(late) || 0));

/** One service of one office, with its judged status and Charter limit. */
function serviceRow(cell, charterByKey, names, minCompleted) {
  const status = PERFORMANCE_STATUS[RISK_TO_STATUS[classifyServiceCell(cell, minCompleted)]];
  const charter = charterByKey.get(key(cell.office_id, cell.service_id));
  const limit = Number(charter?.limit_minutes) > 0 ? Number(charter.limit_minutes) : null;
  const p90 = charter?.p90_minutes != null && Number.isFinite(Number(charter.p90_minutes)) ? Number(charter.p90_minutes) : null;
  return {
    id: key(cell.office_id, cell.service_id),
    office_id: cell.office_id,
    service_id: cell.service_id,
    service_code: cell.service_code ?? null,
    service_name: names.services?.[cell.service_id] ?? cell.service_code ?? 'Service',
    // An office that has activity but is not in the office list (for example one that was removed) is named as unknown, not just "Office".
    office_name: names.offices?.[cell.office_id] ?? 'Unknown office',
    completed: Number(cell.completed) || 0,
    late: Number(cell.late) || 0,
    on_time: onTimeCount(cell.completed, cell.late),
    late_rate: cell.late_rate ?? null,
    status,
    limit_minutes: limit,
    limit_text: limit ? minutesText(limit) : 'Not recorded',
    p90_minutes: p90,
    // How far the slowest 1 in 10 runs past the Charter limit; null when it does not, or when either figure is missing.
    over_limit_minutes: limit && p90 != null && p90 > limit ? Math.round(p90 - limit) : null,
    cell,
  };
}

const byWorst = (a, b) => a.status.rank - b.status.rank || (Number(b.late_rate) || 0) - (Number(a.late_rate) || 0)
  || b.completed - a.completed || a.service_name.localeCompare(b.service_name);

/**
 * { services, offices, attention }:
 *   services   every judged service row with activity this period (scope-filtered), worst first
 *   offices    one row per active office: on-time and late totals (sums of that office's services), status and its services
 *   attention  the delayed and needs-attention services, worst first
 */
export function buildOfficePerformanceModel({
  overview,
  offices = [],
  services: catalogue = [],
  names = {},
  scope = { kind: 'campus', officeId: null },
} = {}) {
  const minCompleted = Number(overview?.min_cell_completed) || MIN_CELL_COMPLETED;
  const scoped = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;
  const charterByKey = new Map((overview?.charter?.services ?? []).map((row) => [key(row.office_id, row.service_id), row]));

  const services = [];
  for (const cell of overview?.heatmap ?? []) {
    if (!cell || Number(cell.completed) <= 0) continue;
    if (scoped && String(cell.office_id ?? '').toLowerCase() !== scoped) continue;
    services.push(serviceRow(cell, charterByKey, names, minCompleted));
  }
  services.sort(byWorst);

  const officeIds = new Map();
  for (const o of offices) {
    if (o?.is_active === false || !o?.office_id) continue;
    if (scoped && String(o.office_id).toLowerCase() !== scoped) continue;
    officeIds.set(String(o.office_id).toLowerCase(), { id: o.office_id, name: o.office_name ?? o.office_id, code: o.office_code ?? null });
  }
  // An office that has activity but is not in the catalogue list yet (still loading) is shown under its own id.
  for (const s of services) {
    const k = String(s.office_id).toLowerCase();
    // Unknown to the office list: show a short piece of its ID so it can be found in the data.
    if (!officeIds.has(k)) officeIds.set(k, { id: s.office_id, name: s.office_name, code: names.offices?.[s.office_id] ? null : `ID ${String(s.office_id).slice(0, 8)}` });
  }

  const officeRows = [...officeIds.entries()].map(([k, o]) => {
    const own = services.filter((s) => String(s.office_id).toLowerCase() === k);
    const seen = new Set(own.map((s) => String(s.service_id).toLowerCase()));
    // Active catalogue services of this office with no completed transaction in the period.
    const noActivity = (catalogue ?? [])
      .filter((c) => c && c.is_active !== false && String(c.office_id ?? '').toLowerCase() === k && !seen.has(String(c.service_id).toLowerCase()))
      .map((c) => ({ service_id: c.service_id, service_code: c.service_code ?? null, service_name: c.service_name ?? c.service_code ?? 'Service' }))
      .sort((a, b) => a.service_name.localeCompare(b.service_name));
    const completed = own.reduce((sum, s) => sum + s.completed, 0);
    const late = own.reduce((sum, s) => sum + s.late, 0);
    const worst = own.length ? own.reduce((a, b) => (b.status.rank < a.status.rank ? b : a)).status : PERFORMANCE_STATUS.no_data;
    return {
      office_id: o.id,
      office_name: o.name,
      office_code: o.code,
      completed,
      late,
      on_time: onTimeCount(completed, late),
      late_rate: completed > 0 ? Math.round((late / completed) * 1000) / 10 : null,
      delayed_services: own.filter((s) => s.status.key === 'delayed').length,
      attention_services: own.filter((s) => s.status.key === 'attention').length,
      status: worst,
      services: own,
      no_activity: noActivity,
    };
  }).sort((a, b) => a.status.rank - b.status.rank || (Number(b.late_rate) || 0) - (Number(a.late_rate) || 0)
    || a.office_name.localeCompare(b.office_name));

  const attention = services.filter((s) => s.status.key === 'delayed' || s.status.key === 'attention');
  return { services, offices: officeRows, attention };
}

export const SERVICE_FILTERS = Object.freeze([
  ['all', 'All Services'],
  ['delayed', 'Delayed Only'],
  ['on_time', 'On Time Only'],
]);

/** The Services by Office filter and search. "Delayed Only" holds both delayed and needs-attention rows (anything not on time). */
export function filterOfficeServices(rows = [], filter = 'all', query = '') {
  const q = String(query ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'delayed' && !(r.status.key === 'delayed' || r.status.key === 'attention')) return false;
    if (filter === 'on_time' && r.status.key !== 'on_time') return false;
    if (!q) return true;
    return r.service_name.toLowerCase().includes(q) || String(r.service_code ?? '').toLowerCase().includes(q);
  });
}

export const SERVICE_SORTS = Object.freeze({
  service: (a, b) => a.service_name.localeCompare(b.service_name),
  requests: (a, b) => b.completed - a.completed || a.service_name.localeCompare(b.service_name),
  performance: byWorst,
});

/** Text for the on-time/late tooltip and screen-reader label of a bar. */
export function barLabel({ completed, late }) {
  const total = Number(completed) || 0;
  const l = Number(late) || 0;
  if (total === 0) return 'No completed transactions this period';
  return `${onTimeCount(total, l)} on time and ${l} late of ${total} completed (${pct(Math.round((l / total) * 1000) / 10)} late)`;
}

/** The card text for an alert: its late-rate line, and how far past the Charter limit the slowest 1 in 10 run. */
export function alertMetrics(row) {
  return {
    lateLine: `${pct(row.late_rate)} Late (${row.late} of ${row.completed})`,
    limitLine: row.limit_text,
    overLine: row.over_limit_minutes != null
      ? `Slowest 1 in 10 run ${minutesText(row.over_limit_minutes)} past the limit`
      : 'Slowest 1 in 10 finish within the limit',
  };
}
