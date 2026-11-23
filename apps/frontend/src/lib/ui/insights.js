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
export const CHART_ANCHOR = Object.freeze({ heatmap: 'insights-heatmap', pulse: 'insights-pulse', charter: 'insights-charter', forecast: 'insights-forecast', lateRisk: 'insights-late-risk' });

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
    case 5: return `${plural(p.n, 'transaction', 'transactions')} took more than three times the usual time`;
    case 6: return `${plural(p.n, 'open transaction is', 'open transactions are')} at high risk of being late`;
    default: return '';
  }
}

export const FORECAST_RISE_MIN = 20;
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
// Asia/Manila has no daylight saving, so a fixed UTC+08:00 offset always gives the right calendar date
// (the same approach as lib/ui/date-format.js, which this file does not import to stay a standalone util).
export function manilaToday(now = new Date()) {
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${manila.getUTCFullYear()}-${pad(manila.getUTCMonth() + 1)}-${pad(manila.getUTCDate())}`;
}

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

export const SERVICE_RISK_LEGEND = Object.freeze([
  {
    key: 'high',
    label: 'High late rate',
    swatch: 'border-[#D97777] bg-[#FDF2F2]',
    card: 'border border-[#D97777] bg-[#FDF2F2] text-[#4A0808] hover:border-[#800000] hover:bg-[#FCE8E8]',
    codeText: 'text-[#800000]',
    valueText: 'text-[#4A0808]',
  },
  {
    key: 'watch',
    label: 'Watch',
    swatch: 'border-[#E5B53A] bg-[#FFFBEB]',
    card: 'border border-[#E5B53A] bg-[#FFFBEB] text-[#78350F] hover:border-[#B45309] hover:bg-[#FEF3C7]',
    codeText: 'text-[#92400E]',
    valueText: 'text-[#78350F]',
  },
  {
    key: 'on_track',
    label: 'On track',
    swatch: 'border-emerald-300 bg-emerald-50',
    card: 'border border-emerald-300 bg-emerald-50 text-emerald-950 hover:border-emerald-500 hover:bg-emerald-100/80',
    codeText: 'text-emerald-800',
    valueText: 'text-emerald-950',
  },
  {
    key: 'too_few',
    label: 'Too few to judge',
    swatch: 'border-dashed border-slate-300 bg-slate-50',
    card: 'border border-[#E2E8F0] bg-[#F8FAFC] text-[#202938] hover:border-slate-300 hover:bg-[#F1F5F9]',
    codeText: 'text-[#202938]',
    valueText: 'text-[#64748B]',
  },
]);

export const SERVICE_RISK_STYLES = Object.freeze(Object.fromEntries(SERVICE_RISK_LEGEND.map((item) => [item.key, item])));
const RISK_SEVERITY_ORDER = Object.freeze({ high: 0, watch: 1, on_track: 2, too_few: 3 });

export function classifyServiceCell(cell, minCompleted = MIN_CELL_COMPLETED) {
  if (!cell || cell.too_few || Number(cell.completed) < minCompleted) return 'too_few';
  const rate = Number(cell.late_rate);
  if (rate > 20) return 'high';
  if (rate > 10) return 'watch';
  return 'on_track';
}

export const isFlaggedRisk = (riskKey) => riskKey === 'high' || riskKey === 'watch';

export function buildServiceLateRateModel({
  heatmap = [],
  offices = [],
  services = [],
  names = {},
  scope = { kind: 'campus', officeId: null },
  filter = 'all',
  minCompleted = MIN_CELL_COMPLETED,
} = {}) {
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;
  const activeOfficeIds = new Set(offices.filter((o) => o?.is_active !== false).map((o) => String(o.office_id).toLowerCase()));
  const seenKeys = new Set();

  const items = [];
  for (const raw of heatmap ?? []) {
    if (!raw || Number(raw.completed) <= 0) continue;
    const oKey = String(raw.office_id ?? '').toLowerCase();
    if (scopedOffice && oKey !== scopedOffice) continue;
    seenKeys.add(`${oKey}|${String(raw.service_id ?? '').toLowerCase()}`);
    const risk = classifyServiceCell(raw, minCompleted);
    const flagged = isFlaggedRisk(risk);
    items.push({
      ...raw,
      risk,
      flagged,
      office_name: names.offices?.[raw.office_id] ?? 'Office',
      service_name: names.services?.[raw.service_id] ?? raw.service_code ?? 'Service',
      label: risk === 'too_few' ? 'Too few' : `${pct(raw.late_rate)} late`,
    });
  }

  const flaggedTotalByOffice = new Map();
  const judgedTotalByOffice = new Map();
  for (const item of items) {
    if (item.flagged) flaggedTotalByOffice.set(item.office_id, (flaggedTotalByOffice.get(item.office_id) ?? 0) + 1);
    if (item.risk !== 'too_few') judgedTotalByOffice.set(item.office_id, (judgedTotalByOffice.get(item.office_id) ?? 0) + 1);
  }

  const filtered = filter === 'flagged'
    ? items.filter((i) => i.flagged)
    : filter === 'too_few'
      ? items.filter((i) => i.risk === 'too_few')
      : items;

  const grouped = new Map();
  for (const item of filtered) {
    const flaggedCount = flaggedTotalByOffice.get(item.office_id) ?? 0;
    const judgedCount = judgedTotalByOffice.get(item.office_id) ?? 0;
    const existing = grouped.get(item.office_id) ?? {
      office_id: item.office_id,
      office_name: item.office_name,
      flagged_count: flaggedCount,
      low_volume: flaggedCount === 0 && judgedCount === 0,
      cards: [],
    };
    existing.cards.push(item);
    grouped.set(item.office_id, existing);
  }

  const officeRows = [...grouped.values()]
    .map((row) => ({
      ...row,
      cards: [...row.cards].sort(
        (a, b) => RISK_SEVERITY_ORDER[a.risk] - RISK_SEVERITY_ORDER[b.risk]
          || (Number(b.late_rate) || 0) - (Number(a.late_rate) || 0)
          || String(a.service_code).localeCompare(String(b.service_code)),
      ),
    }))
    .sort((a, b) => (b.flagged_count - a.flagged_count) || a.office_name.localeCompare(b.office_name));

  const noActivityServices = (services ?? [])
    .filter((s) => {
      if (!s || s.is_active === false) return false;
      const oKey = String(s.office_id ?? '').toLowerCase();
      if (scopedOffice && oKey !== scopedOffice) return false;
      if (offices.length > 0 && !activeOfficeIds.has(oKey)) return false;
      return !seenKeys.has(`${oKey}|${String(s.service_id ?? '').toLowerCase()}`);
    })
    .map((s) => ({
      service_id: s.service_id,
      office_id: s.office_id,
      service_code: s.service_code,
      service_name: s.service_name,
      office_name: names.offices?.[s.office_id] ?? '',
    }))
    .sort((a, b) => String(a.service_name).localeCompare(String(b.service_name)));

  return {
    officeRows,
    noActivityServices,
    counts: {
      all: items.length,
      flagged: items.filter((i) => i.flagged).length,
      tooFew: items.filter((i) => i.risk === 'too_few').length,
    },
  };
}

export function filterNoActivityServices(services = [], query = '') {
  const list = Array.isArray(services) ? services : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => (
    String(s?.service_name ?? '').toLowerCase().includes(q)
    || String(s?.service_code ?? '').toLowerCase().includes(q)
    || String(s?.office_name ?? '').toLowerCase().includes(q)
  ));
}

export const minutesText = (minutes) => {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m)) return '–';
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};

export const sortRows = (rows, key, dir = 'desc') => [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * ((Number(a[key]) || 0) - (Number(b[key]) || 0)));
export const filterByFlag = (rows, flag) => (flag ? rows.filter((r) => r.flags?.includes(flag)) : rows);

export const CHARTER_SHOW_OPTIONS = Object.freeze([
  ['', 'All services'],
  ['flagged', 'Flagged'],
  ['too_few', 'Too few to judge'],
]);

export const CHARTER_SORT_OPTIONS = Object.freeze([
  ['late_rate', 'Late rate'],
  ['p90_minutes', 'Highest actual processing time'],
  ['completed', 'Most completed'],
  ['service_name', 'Service name'],
]);

export function isCharterLowSample(row, minReliable = MIN_CELL_COMPLETED) {
  return Boolean(row?.flags?.includes('NOT_ENOUGH_DATA') || Number(row?.completed ?? 0) < minReliable);
}

export function durationComparisonStatus(row) {
  if (!(Number(row?.limit_minutes) > 0) || row?.p90_minutes == null || !Number.isFinite(Number(row.p90_minutes))) return null;
  return Number(row.p90_minutes) > Number(row.limit_minutes) ? 'over' : 'within';
}

export function isCharterFlagged(row, minReliable = MIN_CELL_COMPLETED) {
  if (!row || isCharterLowSample(row, minReliable)) return false;
  if (row.flags?.some((f) => f === 'LIMIT_OFTEN_MISSED' || f === 'LIMIT_FAR_LONGER')) return true;
  if (Number(row.late_rate) > 10) return true;
  return durationComparisonStatus(row) === 'over';
}

export function filterCharterRows(rows = [], show = '', { minReliable = MIN_CELL_COMPLETED } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!show) return list;
  if (show === 'flagged') return list.filter((r) => isCharterFlagged(r, minReliable));
  if (show === 'too_few') return list.filter((r) => isCharterLowSample(r, minReliable));
  return filterByFlag(list, show);
}

export function sortCharterRows(rows = [], sortKey = 'late_rate', names = {}) {
  const list = [...(Array.isArray(rows) ? rows : [])];
  const serviceLabel = (r) => String(names.services?.[r?.service_id] || r?.service_code || '');
  const officeLabel = (r) => String(names.offices?.[r?.office_id] || '');

  if (sortKey === 'service_name') {
    return list.sort((a, b) => serviceLabel(a).localeCompare(serviceLabel(b)) || officeLabel(a).localeCompare(officeLabel(b)));
  }

  return list.sort((a, b) => {
    const va = a?.[sortKey];
    const vb = b?.[sortKey];
    const na = va == null ? -Infinity : Number(va);
    const nb = vb == null ? -Infinity : Number(vb);
    const aNum = Number.isFinite(na) ? na : -Infinity;
    const bNum = Number.isFinite(nb) ? nb : -Infinity;
    if (bNum !== aNum) return bNum - aNum;
    return (Number(b?.completed) || 0) - (Number(a?.completed) || 0) || serviceLabel(a).localeCompare(serviceLabel(b));
  });
}

export function filterScopedUnusual(unusual = [], scope = { kind: 'campus', officeId: null }) {
  const list = Array.isArray(unusual) ? unusual : [];
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;
  if (!scopedOffice) return list;
  return list.filter((u) => !u?.office_id || String(u.office_id).toLowerCase() === scopedOffice);
}

/**
 * Computes the empty-state classification and highest single-service volume badge data for Unusual Delays
 * from actual Oversight analytics data without altering the 20-transaction statistical eligibility threshold.
 */
export function buildUnusualEmptyState({ overview, scope = { kind: 'campus', officeId: null } } = {}) {
  const minCompleted = Number(overview?.charter?.thresholds?.min_completed) || 20;
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;

  const byKey = new Map();
  for (const row of [...(overview?.charter?.services ?? []), ...(overview?.heatmap ?? [])]) {
    if (!row || Number(row.completed) <= 0) continue;
    const oKey = String(row.office_id ?? '').toLowerCase();
    if (scopedOffice && oKey !== scopedOffice) continue;
    const key = `${oKey}|${String(row.service_id ?? row.service_code ?? '').toLowerCase()}`;
    if (!byKey.has(key) || Number(row.completed) > Number(byKey.get(key).completed)) {
      byKey.set(key, {
        office_id: row.office_id,
        service_id: row.service_id,
        service_code: row.service_code || 'SERVICE',
        completed: Number(row.completed),
      });
    }
  }

  const services = [...byKey.values()].sort(
    (a, b) => b.completed - a.completed || String(a.service_code).localeCompare(String(b.service_code)),
  );
  const topService = services[0] ?? null;
  const eligibleCount = services.filter((s) => s.completed >= minCompleted).length;

  const reason = !topService
    ? 'no_transactions'
    : eligibleCount === 0
      ? 'insufficient_data'
      : 'none_detected';

  return {
    reason,
    minCompleted,
    topService,
    eligibleCount,
  };
}

const LATE_RISK_LEVEL_RANK = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1 });

export const LATE_RISK_SORT_OPTIONS = Object.freeze([
  { value: 'risk_desc', label: 'Sort: Risk Score ↓' },
  { value: 'minutes_asc', label: 'Sort: Working Time Left ↑' },
  { value: 'minutes_desc', label: 'Sort: Working Time Left ↓' },
  { value: 'share_desc', label: 'Sort: Time Limit Used ↓' },
]);

/** Derives time-consumption and time-limit metrics purely from actual backend late-risk item fields. */
export function deriveLateRiskItemMetrics(item) {
  if (!item) {
    return {
      share: null,
      pctUsed: null,
      consumptionLabel: '—',
      barFillPct: 0,
      isOverLimit: false,
      isSeverelyOverdue: false,
      limitText: 'Standard time limit',
      limitSubtext: "Per Citizen's Charter schedule",
      elapsedText: 'Active clock',
      elapsedSubtext: 'Tracked in working minutes',
      overdueMinutes: null,
      overdueText: null,
    };
  }

  let share = null;
  if (typeof item.share_used === 'number' && Number.isFinite(item.share_used)) {
    share = item.share_used;
  } else if (typeof item.reason === 'string') {
    const match = item.reason.match(/(\d+(?:\.\d+)?)%\s+of\s+the\s+time\s+limit\s+used/i);
    if (match) share = Number(match[1]) / 100;
  }

  const minsLeft = Math.max(0, Number(item.working_minutes_left ?? 0));
  const isOverLimit = (share !== null && share > 1) || (minsLeft === 0 && item.level === 'HIGH');
  const isSeverelyOverdue = share !== null && share >= 2;

  let pctUsed = null;
  let consumptionLabel = `${minsLeft.toLocaleString('en-PH')} min remaining`;
  let barFillPct = item.level === 'HIGH' ? 88 : item.level === 'MEDIUM' ? 55 : 24;

  if (share !== null) {
    pctUsed = Math.round(share * 1000) / 10;
    barFillPct = Math.max(4, Math.min(100, Math.round(share * 100)));
    if (share >= 2) {
      const mult = Math.round(share * 10) / 10;
      consumptionLabel = `${mult}× limit (${Math.round(share * 100).toLocaleString('en-PH')}%)`;
    } else {
      consumptionLabel = `${pctUsed.toLocaleString('en-PH')}% of limit used`;
    }
  } else if (minsLeft === 0) {
    barFillPct = 100;
    consumptionLabel = '100%+ of limit used (0 min left)';
  }

  let limitMinutes = Number(item.limit_minutes) > 0 ? Number(item.limit_minutes) : null;
  if (!limitMinutes && share !== null && share > 0 && share < 1 && minsLeft > 0) {
    limitMinutes = Math.round(minsLeft / (1 - share));
  }
  const elapsedMinutes = Number(item.elapsed_working_minutes) >= 0 && item.elapsed_working_minutes != null
    ? Number(item.elapsed_working_minutes)
    : (limitMinutes && share !== null ? Math.round(limitMinutes * share) : null);

  const limitText = limitMinutes ? minutesText(limitMinutes) : 'Charter time limit';
  const limitSubtext = item.service_classification
    ? `${item.service_classification} Charter time limit`
    : 'ARTA standard time limit';

  let elapsedText = 'In progress';
  let elapsedSubtext = minsLeft > 0 ? `${minsLeft.toLocaleString('en-PH')} min remaining` : 'At or past charter limit';
  if (elapsedMinutes !== null) {
    elapsedText = minutesText(elapsedMinutes);
    if (limitMinutes && elapsedMinutes > limitMinutes) {
      elapsedSubtext = `+${minutesText(elapsedMinutes - limitMinutes)} over limit`;
    }
  } else if (share !== null) {
    elapsedText = `${Math.round(share * 100).toLocaleString('en-PH')}% used`;
    if (share > 1) {
      elapsedSubtext = `+${Math.round((share - 1) * 100).toLocaleString('en-PH')}% over limit`;
    }
  } else if (minsLeft === 0) {
    elapsedText = 'Limit reached';
  }

  // S8-25: an item past its limit is described by how long it is overdue (working time), never by a huge percentage of the limit.
  // The service sends overdue_working_minutes when it knows it (or limit_minutes with elapsed_working_minutes); without either, the
  // item is called overdue and past the Charter limit, with no invented figure.
  let overdueMinutes = null;
  if (isOverLimit) {
    const given = Number(item.overdue_working_minutes);
    if (Number.isFinite(given) && given > 0) overdueMinutes = Math.round(given);
    else if (limitMinutes && elapsedMinutes !== null && elapsedMinutes > limitMinutes) overdueMinutes = Math.round(elapsedMinutes - limitMinutes);
  }
  const overdueText = isOverLimit
    ? (overdueMinutes ? `Overdue by ${minutesText(overdueMinutes)} (working time)` : 'Overdue (past the Charter time limit)')
    : null;
  if (isOverLimit) {
    pctUsed = null;
    barFillPct = 100;
    consumptionLabel = overdueText;
    if (elapsedMinutes === null) {
      elapsedText = 'Past the limit';
      elapsedSubtext = 'Overdue';
    }
  }

  return {
    share,
    pctUsed,
    consumptionLabel,
    barFillPct,
    isOverLimit,
    isSeverelyOverdue,
    limitMinutes,
    elapsedMinutes,
    limitText,
    limitSubtext,
    elapsedText,
    elapsedSubtext,
    overdueMinutes,
    overdueText,
  };
}

/**
 * Builds the vertical Processing Milestones timeline from actual transaction late-risk fields
 * without fabricating timestamps or altering workflow status.
 */
export function buildLateRiskMilestones(item, { formattedStart = '', formattedAsOf = '' } = {}) {
  if (!item) return [];
  if (Array.isArray(item.milestones) && item.milestones.length > 0) {
    return item.milestones;
  }

  const m = deriveLateRiskItemMetrics(item);
  const minsLeft = Math.max(0, Number(item.working_minutes_left ?? 0));
  const isStalledOrHigh = m.isOverLimit || minsLeft <= 0 || item.level === 'HIGH';

  const submittedSub = formattedStart
    || (formattedAsOf ? `Active in queue as of ${formattedAsOf}` : 'Logged in operations queue');

  // An overdue item is described by its overdue time (or just as overdue), never by the service's "12741% of the time limit used" text.
  const verifiedSub = m.isOverLimit
    ? m.overdueText
    : m.pctUsed !== null
      ? `${Math.round(m.pctUsed).toLocaleString('en-PH')}% of Citizen's Charter limit consumed`
      : (item.reason || 'Working-time clock is running');

  if (isStalledOrHigh) {
    const stalledReason = minsLeft <= 0
      ? `Stalled · ${m.elapsedMinutes && m.limitMinutes && m.elapsedMinutes > m.limitMinutes ? `Over the time limit by ${minutesText(m.elapsedMinutes - m.limitMinutes)}` : 'Over the Citizen’s Charter time limit (0 min left)'}`
      : `At Risk · ${minsLeft.toLocaleString('en-PH')} min remaining (${item.reason || 'High deadline risk'})`;

    return [
      {
        id: 'logged',
        title: 'Request Logged in Operations Queue',
        subtitle: submittedSub,
        state: 'completed',
      },
      {
        id: 'verified',
        title: 'Initial Document & Deadline Check',
        subtitle: verifiedSub,
        state: 'completed',
      },
      {
        id: 'stalled',
        title: item.reason && !/time limit used/i.test(item.reason)
          ? item.reason
          : 'Active Processing Stage',
        subtitle: stalledReason,
        state: 'stalled',
      },
      {
        id: 'release',
        title: 'Final Completion & Release',
        subtitle: 'Pending',
        state: 'pending',
      },
    ];
  }

  return [
    {
      id: 'logged',
      title: 'Application Logged',
      subtitle: submittedSub,
      state: 'completed',
    },
    {
      id: 'verified',
      title: 'Initial Verification Complete',
      subtitle: verifiedSub,
      state: 'completed',
    },
    {
      id: 'encoding',
      title: 'Final Processing (On Track)',
      subtitle: `${minutesText(minsLeft)} (${minsLeft.toLocaleString('en-PH')} min) buffer remaining`,
      state: 'on_track',
    },
  ];
}

export function sortQueueItems(items = [], sortKey = 'risk_desc') {
  const list = [...items];
  if (sortKey === 'minutes_asc') {
    return list.sort((a, b) => (Number(a.working_minutes_left) || 0) - (Number(b.working_minutes_left) || 0) || String(a.tracking_no).localeCompare(String(b.tracking_no)));
  }
  if (sortKey === 'minutes_desc') {
    return list.sort((a, b) => (Number(b.working_minutes_left) || 0) - (Number(a.working_minutes_left) || 0) || String(a.tracking_no).localeCompare(String(b.tracking_no)));
  }
  if (sortKey === 'share_desc') {
    const getShare = (r) => deriveLateRiskItemMetrics(r).share ?? -1;
    return list.sort((a, b) => getShare(b) - getShare(a) || (Number(a.working_minutes_left) || 0) - (Number(b.working_minutes_left) || 0));
  }
  return list.sort((a, b) => (
    (LATE_RISK_LEVEL_RANK[b.level] ?? 0) - (LATE_RISK_LEVEL_RANK[a.level] ?? 0)
    || (Number(b.probability ?? -1) - Number(a.probability ?? -1))
    || (Number(a.working_minutes_left) || 0) - (Number(b.working_minutes_left) || 0)
    || String(a.tracking_no).localeCompare(String(b.tracking_no))
  ));
}

/** Counts flagged services and unusual transactions for the Dashboard tab badges from live Oversight data. */
export function dashboardAuditCounts({ overview, scope = { kind: 'campus', officeId: null } } = {}) {
  const minReliable = Number(overview?.min_cell_completed) || MIN_CELL_COMPLETED;
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;
  const flaggedKeys = new Set();

  for (const row of overview?.charter?.services ?? []) {
    if (!row) continue;
    const oKey = String(row.office_id ?? '').toLowerCase();
    if (scopedOffice && oKey !== scopedOffice) continue;
    if (isCharterFlagged(row, minReliable)) {
      flaggedKeys.add(`${oKey}|${String(row.service_id ?? '').toLowerCase()}`);
    }
  }

  for (const cell of overview?.heatmap ?? []) {
    if (!cell || Number(cell.completed) <= 0) continue;
    const oKey = String(cell.office_id ?? '').toLowerCase();
    if (scopedOffice && oKey !== scopedOffice) continue;
    if (isFlaggedRisk(classifyServiceCell(cell, minReliable))) {
      flaggedKeys.add(`${oKey}|${String(cell.service_id ?? '').toLowerCase()}`);
    }
  }

  const unusualCount = filterScopedUnusual(overview?.charter?.unusual, scope).length;
  return { flaggedCount: flaggedKeys.size, unusualCount };
}

export function buildDashboardTabs({ flaggedCount = 0, unusualCount = 0 } = {}) {
  const f = Math.max(0, Number(flaggedCount) || 0);
  const u = Math.max(0, Number(unusualCount) || 0);
  return [
    { id: 'overview', label: 'Executive Overview' },
    { id: 'heatmap', label: 'Office Performance Overview' },
    {
      id: 'charter',
      label: 'Service Charter Compliance',
      badge: `${f} flagged`,
      badgeTone: f > 0 ? 'gold' : 'neutral',
    },
    {
      id: 'unusual',
      label: 'Unusual Delays',
      badge: String(u),
      badgeTone: u > 0 ? 'gold' : 'neutral',
    },
  ];
}

export const PERIODS = Object.freeze([['weekly', 'This week'], ['monthly', 'This month'], ['half_year', 'This half-year'], ['annual', 'This year']]);

/** KPI label for completed transactions that follows the selected period ("Completed this month", "Completed this week", ...). */
export function completedKpiLabel(period) {
  const found = PERIODS.find(([value]) => value === period);
  return found ? `Completed ${found[1].toLowerCase()}` : 'Completed in this period';
}
