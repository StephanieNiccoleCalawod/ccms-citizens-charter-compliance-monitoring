// Insights wording and colours (CC053 / CC054). The server sends a template id and its numbers (ids, never names); the words are
// written here from the same numbers, with names taken from the catalogue. The six templates are those of the Sprint 5-8 specification, section 3.3.
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

const PERIOD_WORDS = Object.freeze({ weekly: 'this week', monthly: 'this month', half_year: 'this half-year', annual: 'this year', custom: 'the period' });
export const CHART_ANCHOR = Object.freeze({ heatmap: 'insights-heatmap', pulse: 'insights-pulse', charter: 'insights-charter', forecast: 'insights-models' });

/** The six fixed templates of spec 3.3. Names come from the catalogue maps { id: name }; a missing name falls back to the service code or "An office". */
export function sentenceText(sentence, names = {}) {
  const p = sentence?.params ?? {};
  const office = names.offices?.[p.office_id] ?? 'An office';
  const service = names.services?.[p.service_id] ?? p.service_code ?? 'A service';
  switch (sentence?.template) {
    case 1: return `${office} requests are expected to rise ${Math.round(Number(p.x))}% next week`;
    case 2: return `${service} was late ${Math.round(Number(p.late_rate))}% of the time in ${PERIOD_WORDS[p.period] ?? 'the period'}`;
    case 3: return `${office}'s late rate ${p.direction === 'rose' ? 'rose' : 'fell'} from ${pct(p.from_rate)} to ${pct(p.to_rate)}`;
    case 4: return `${service} is usually done in ${Math.round(Number(p.share_of_limit))}% of its time limit`;
    case 5: return `${plural(p.n, 'unusual case', 'unusual cases')} took more than three times the usual time`;
    case 6: return `${plural(p.n, 'open transaction is', 'open transactions are')} at high risk of being late`;
    default: return '';
  }
}

export const FORECAST_RISE_MIN = 20;
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
export const manilaToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/** Template 1: the forecast weekly total against the last 5 working days. Only when the forecast is ready and the rise is 20% or more. */
export function forecastSentence(forecast, officeId) {
  if (!officeId || forecast?.status !== 'SUCCESS') return null;
  const history = [...(forecast.history ?? [])].sort(byDate).slice(-5);
  const total = Number(forecast.weeklyTotal);
  if (history.length < 5 || !Number.isFinite(total)) return null;
  const last5 = history.reduce((sum, h) => sum + Number(h.count || 0), 0);
  if (last5 <= 0) return null;
  const x = ((total - last5) / last5) * 100;
  if (x < FORECAST_RISE_MIN) return null;
  return { id: 't1', template: 1, kind: 'attention', chart: 'forecast', score: total - last5, params: { office_id: officeId, x: Math.round(x * 10) / 10 } };
}

/** Template 6: open transactions the late-risk model rates High. */
export function highRiskSentence(risk) {
  const n = (risk?.items ?? []).filter((i) => i.level === 'HIGH').length;
  return n >= 1 ? { id: 't6', template: 6, kind: 'warning', chart: 'pulse', score: n, params: { n } } : null;
}

/** Server candidates (2 to 5) plus 1 and 6 from Operations, ranked by score (effect x volume), cut to the server's maximum (6). */
export function mergeSentences(serverSentences, extra, max = 6) {
  return [...(serverSentences ?? []), ...extra.filter(Boolean)]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.template - b.template)
    .slice(0, max);
}

/**
 * Pulse "today's forecast": the forecast point dated today (Manila). "Behind" when completed today + still open is below the low end
 * of the range; otherwise "on track". Null when there is no usable forecast for today.
 */
export function todayForecast(forecast, pulse, now = new Date()) {
  if (forecast?.status !== 'SUCCESS' || !pulse) return null;
  const point = (forecast.forecast ?? []).find((f) => f.date === manilaToday(now));
  if (!point) return null;
  const sofar = Number(pulse.completed_today) + Number(pulse.open_now);
  return { expected: Math.round(point.point), lower: Math.round(point.lower), upper: Math.round(point.upper), status: sofar < point.lower ? 'behind' : 'on track' };
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
