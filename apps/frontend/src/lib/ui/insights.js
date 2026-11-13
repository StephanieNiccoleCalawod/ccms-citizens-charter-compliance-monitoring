// Insights wording and colours (CC053 / CC054). The server sends a template id and its numbers (ids, never names); the words are
// written here from the same numbers, with names taken from the catalogue. The six templates are PROPOSED pending the spec (section 3.3).
export const MIN_CELL_COMPLETED = 5;
export const FLAG_LABEL = Object.freeze({
  LIMIT_OFTEN_MISSED: 'Limit often missed',
  LIMIT_FAR_LONGER: 'Limit far longer than needed',
  NOT_ENOUGH_DATA: 'Not enough data',
});
export const FLAG_HELP = Object.freeze({
  LIMIT_OFTEN_MISSED: 'More than 20% of completed transactions were late.',
  LIMIT_FAR_LONGER: 'Nine in ten transactions finish in under a quarter of the Charter limit.',
  NOT_ENOUGH_DATA: 'Fewer than 20 completed transactions, so no judgement is made.',
});

const pct = (value) => `${Math.round(Number(value) * 10) / 10}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Names come from the catalogue maps { id: name }; a missing name falls back to the service code or "an office". */
export function sentenceText(sentence, names = {}) {
  const p = sentence?.params ?? {};
  const office = names.offices?.[p.office_id] ?? 'an office';
  const service = names.services?.[p.service_id] ?? p.service_code ?? 'a service';
  switch (sentence?.template) {
    case 1: return `${service} at ${office} is the biggest bottleneck: ${pct(p.late_rate)} late (${p.late} of ${p.completed} completed).`;
    case 2: return p.change > 0
      ? `On-time rate is up ${pct(Math.abs(p.change))} from the previous period (${pct(p.previous_on_time_rate)} to ${pct(p.on_time_rate)}).`
      : `On-time rate is down ${pct(Math.abs(p.change))} from the previous period (${pct(p.previous_on_time_rate)} to ${pct(p.on_time_rate)}).`;
    case 3: return `${service} has the most late transactions: ${plural(p.late, 'late transaction', 'late transactions')} out of ${p.completed} completed.`;
    case 4: return `${office} has the lowest on-time rate: ${pct(p.on_time_rate)} across ${p.completed} completed transactions.`;
    case 5: return p.flag === 'LIMIT_OFTEN_MISSED'
      ? `The Charter limit for ${service} at ${office} is often missed: ${pct(p.late_rate)} of ${p.completed} completed were late.`
      : `The Charter limit for ${service} at ${office} is far longer than needed: nine in ten finish within ${pct(p.p90_share_of_limit)} of it.`;
    case 6: return `${plural(p.auto_closed, 'transaction was', 'transactions were')} closed automatically as late, out of ${p.received} received.`;
    default: return '';
  }
}

/** Heat colour by late rate. A cell with fewer than MIN_CELL_COMPLETED completed is grey ("too few"), never coloured. */
export function heatClass(cell) {
  if (!cell || cell.too_few || cell.completed < MIN_CELL_COMPLETED) return 'bg-slate-200 text-slate-600';
  const rate = Number(cell.late_rate);
  if (rate === 0) return 'bg-green-100 text-green-900';
  if (rate <= 10) return 'bg-lime-100 text-lime-900';
  if (rate <= 20) return 'bg-amber-100 text-amber-900';
  if (rate <= 35) return 'bg-orange-200 text-orange-900';
  return 'bg-red-200 text-red-900';
}
export const heatLabel = (cell) => (!cell || cell.too_few || cell.completed < MIN_CELL_COMPLETED ? 'Too few' : `${pct(cell.late_rate)} late`);

export const minutesText = (minutes) => {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m)) return '–';
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};

export const sortRows = (rows, key, dir = 'desc') => [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * ((Number(a[key]) || 0) - (Number(b[key]) || 0)));
export const filterByFlag = (rows, flag) => (flag ? rows.filter((r) => r.flags?.includes(flag)) : rows);
export const PERIODS = Object.freeze([['weekly', 'This week'], ['monthly', 'This month'], ['half_year', 'This half-year'], ['annual', 'This year']]);
