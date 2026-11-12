// Rules for the Office Home (CC036) and Campus Home (CC037) tiles, as pure functions (no React, no network, no clock).
// Every figure comes straight from the KPI module's answer, so a tile always equals the report figure for the same period.

/** The Charter target for on-time service, in percent (spec: 100%). */
export const ON_TIME_TARGET = 100;

export const PERIOD_OPTIONS = Object.freeze([
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'half_year', label: 'This half-year' },
  { value: 'annual', label: 'This year' },
]);
export const DEFAULT_PERIOD = 'monthly';

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
  const b = bucket ?? {};
  const r = b.results ?? {};
  return [
    { key: 'received', label: 'Received', value: count(b.received) },
    { key: 'on_time_rate', label: 'On-time rate', value: rateText(r.on_time_rate), note: targetNote(r.on_time_rate), rate: r.on_time_rate ?? null },
    { key: 'on_time', label: 'On time', value: count(r.on_time) },
    { key: 'late', label: 'Late', value: count(r.late_total ?? r.late), note: count(r.late_auto_closed) ? `${count(r.late_auto_closed)} closed automatically` : '' },
    { key: 'pending', label: 'Pending now', value: count(b.pending?.count) },
    { key: 'cancelled', label: 'Cancelled', value: count(b.cancelled) },
  ];
}

/** Rows of the per-staff table (Office Head) or the single own row (Office Staff). Names come from `names` (id -> name). */
export function staffRows(groups, names = new Map()) {
  return (groups ?? [])
    .map((g) => ({
      id: g.user_id,
      name: names.get(g.user_id) || 'Staff member',
      received: count(g.received),
      onTime: count(g.results?.on_time),
      late: count(g.results?.late_total ?? g.results?.late),
      rate: g.results?.on_time_rate ?? null,
      pending: count(g.pending?.count),
      cancelled: count(g.cancelled),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}

/** Rows of the per-office table (Executive), named from `names` (office_id -> office_name); lowest on-time rate first. */
export function officeRows(groups, names = new Map()) {
  return (groups ?? [])
    .map((g) => ({
      id: g.office_id,
      name: names.get(g.office_id) || HOME_MESSAGES.notAvailable,
      received: count(g.received),
      onTime: count(g.results?.on_time),
      late: count(g.results?.late_total ?? g.results?.late),
      rate: g.results?.on_time_rate ?? null,
      pending: count(g.pending?.count),
    }))
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
}

/** What each role asks for: Executive per office (never per staff), Office Head per staff, Office Staff per staff (own row). */
export const groupByFor = (role) => (role === 'EXECUTIVE' ? 'office' : 'staff');

export const periodLabel = (answer) => (answer?.from && answer?.to ? `${answer.from} to ${answer.to}` : '');

/** The words for a failed request. */
export function failureMessage(error) {
  if (error?.status === 403) return HOME_MESSAGES.forbidden;
  return HOME_MESSAGES.loadFailed;
}
