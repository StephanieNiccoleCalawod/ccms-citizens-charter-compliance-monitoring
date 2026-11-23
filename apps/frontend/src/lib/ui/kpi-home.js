// Rules for the Office Home (CC036) and Campus Home (CC037) tiles, as pure functions (no React, no network, no clock).
// Every figure comes straight from the KPI module's answer, so a tile always equals the report figure for the same period.

import { ROLES } from 'ccms-shared/roles';

/** The Charter target for on-time service, in percent (spec: 100%). */
export const ON_TIME_TARGET = 100;

export const PERIOD_OPTIONS = Object.freeze([
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'half_year', label: 'This half-year' },
  { value: 'annual', label: 'This year' },
]);
export const DEFAULT_PERIOD = 'half_year';

export const HOME_MESSAGES = {
  loadFailed: 'The figures could not be loaded right now. Please try again in a few minutes.',
  forbidden: 'You do not have permission to see these figures.',
  empty: 'No transactions in this period yet.',
  noRate: 'No rate yet',
  notAvailable: 'Not available',
};

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** "87.5%" for a rate; null (no completed transaction) shows words, never 0% or 100%. */
export const rateText = (rate) => (rate === null || rate === undefined || Number.isNaN(Number(rate)) ? HOME_MESSAGES.noRate : `${Number(rate)}%`);

/** Whole-percent gap to the target in words, or '' when there is no rate. */
export function targetNote(rate, target = ON_TIME_TARGET) {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) return '';
  const gap = Math.round((target - Number(rate)) * 10) / 10;
  return gap <= 0 ? `Target of ${target}% met` : `${gap} points below the ${target}% target`;
}

/** Working minutes as "2 h 30 min" / "45 min" / "-" (a duration is never guessed). */
export function minutesText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '-';
  const total = Math.round(Number(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** The tiles of one bucket (the totals of the answer, or one group). */
export function tilesFor(bucket) {
  // DEF-16: the KPI answer is { ..., totals, groups }; the figures are under `totals`. A bare bucket (one group) is read as it is.
  const b = bucket?.totals ?? bucket ?? {};
  const r = b.results ?? {};
  const completedCount = b.outcomes?.completed != null ? count(b.outcomes.completed) : count(r.on_time) + count(r.late) + count(r.awaiting_result);
  return [
    { key: 'received', label: 'Received', value: count(b.received) },
    { key: 'completed', label: 'Completed', value: completedCount },
    { key: 'on_time_rate', label: 'On-time rate', value: rateText(r.on_time_rate), note: targetNote(r.on_time_rate), rate: r.on_time_rate ?? null },
    { key: 'on_time', label: 'On time', value: count(r.on_time) },
    { key: 'late', label: 'Late', value: count(r.late_total ?? r.late), note: count(r.late_auto_closed) ? `${count(r.late_auto_closed)} closed automatically` : '' },
    { key: 'pending', label: 'Pending now', value: count(b.pending?.count), note: b.pending?.oldest_age_minutes != null ? `Oldest ${minutesText(b.pending.oldest_age_minutes)}` : '' },
    { key: 'average_time', label: 'Average time', value: minutesText(b.time?.average_minutes) },
    { key: 'median_time', label: 'Median time', value: minutesText(b.time?.median_minutes) },
    { key: 'early', label: 'Early', value: count(b.early?.count), note: b.early?.average_margin_minutes != null ? `Avg margin ${minutesText(b.early.average_margin_minutes)}` : '' },
    { key: 'auto_closed', label: 'Auto-closed', value: count(b.auto_closed ?? r.late_auto_closed) },
    { key: 'cancelled', label: 'Cancelled', value: count(b.cancelled) },
    // CC040: ticket-to-Start wait, its own figure (not a compliance input). Only rows started with a ticket count.
    { key: 'queue_wait', label: 'Average queue wait', value: b.queue_wait?.measured ? `${b.queue_wait.average_minutes} min` : '-', note: b.queue_wait ? `${count(b.queue_wait.measured)} measured` : '' },
  ];
}

/** S8-17: true when some rows could not be given a name (the Office Head is not sent other staff's names yet). */
export const hasUnnamedStaff = (rows) => (rows ?? []).some((row) => row.named === false);

/** Rows of the per-staff table (Office Head) or the single own row (Office Staff). Names come from `names` (id -> name). */
export function staffRows(groups, names = new Map()) {
  return (groups ?? [])
    .map((g) => ({
      id: g.user_id,
      name: names.get(g.user_id) || 'Staff member',
      named: names.has(g.user_id),
      received: count(g.received),
      onTime: count(g.results?.on_time),
      late: count(g.results?.late_total ?? g.results?.late),
      rate: g.results?.on_time_rate ?? null,
      pending: count(g.pending?.count),
      cancelled: count(g.cancelled),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}

/** Rows of the per-office table (Executive), including all active offices from `names` (0 counts / null rate when absent from `groups`); lowest on-time rate first. */
export function officeRows(groups, names = new Map()) {
  const rowsById = new Map();
  for (const g of groups ?? []) {
    rowsById.set(g.office_id, {
      id: g.office_id,
      name: names.get(g.office_id) || HOME_MESSAGES.notAvailable,
      received: count(g.received),
      onTime: count(g.results?.on_time),
      late: count(g.results?.late_total ?? g.results?.late),
      rate: g.results?.on_time_rate ?? null,
      pending: count(g.pending?.count),
    });
  }
  for (const [officeId, officeName] of names instanceof Map ? names.entries() : Object.entries(names ?? {})) {
    if (!rowsById.has(officeId)) {
      rowsById.set(officeId, {
        id: officeId,
        name: officeName || HOME_MESSAGES.notAvailable,
        received: 0,
        onTime: 0,
        late: 0,
        rate: null,
        pending: 0,
      });
    }
  }
  return [...rowsById.values()]
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
}

/** Sort office comparison rows on Campus Home by any table column; rows without a rate stay last when sorting by rate. */
export function sortOfficeRows(rows, sort) {
  if (!sort?.key) return rows;
  const dir = sort.direction === 'desc' ? -1 : 1;
  return [...(rows ?? [])].sort((a, b) => {
    if (sort.key === 'name') return dir * (a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
    if (sort.key === 'rate') {
      if (a.rate === null && b.rate === null) return a.name.localeCompare(b.name);
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
    }
    const diff = Number(a[sort.key] ?? 0) - Number(b[sort.key] ?? 0);
    return diff !== 0 ? dir * diff : a.name.localeCompare(b.name);
  });
}

/** Open transactions (IN_PROGRESS / ON_HOLD) ordered oldest first for Office Home. */
export function oldestFirstPending(items = []) {
  return [...items]
    .filter((item) => item?.status === 'IN_PROGRESS' || item?.status === 'ON_HOLD')
    .sort((a, b) => new Date(a.started_at || 0).getTime() - new Date(b.started_at || 0).getTime() || String(a.tracking_no).localeCompare(String(b.tracking_no)));
}

/** What each role asks for: Executive per office (never per staff), Office Head per staff, Office Staff per staff (own row). */
export const groupByFor = (role) => (role === ROLES.EXECUTIVE ? 'office' : 'staff');

export const periodLabel = (answer) => (answer?.from && answer?.to ? `${answer.from} to ${answer.to}` : '');

/** The words for a failed request. */
export function failureMessage(error) {
  if (error?.status === 403) return HOME_MESSAGES.forbidden;
  return HOME_MESSAGES.loadFailed;
}
