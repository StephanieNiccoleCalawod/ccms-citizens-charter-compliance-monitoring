// Dashboard analytics data adapter (live backend APIs only — zero mock/sample data).
// Combines Oversight's consolidated insights overview (/api/logs/analytics/insights/overview) with
// Operations' per-office forecast (/api/operations/analytics/forecast) and late-risk (/api/operations/analytics/late-risk).
import { apiFetch } from '../auth/session.js';
import { applyScope, normalizeHeatmap } from '../ui/analytics.js';
import { completedKpiLabel, forecastSentence, highRiskSentence, mergeSentences, minutesText, sentenceText } from '../ui/insights.js';
import { getInsightsOverview, getOfficeForecast, getOfficeLateRisk } from './insights.js';

const DASHBOARD_ANCHOR = Object.freeze({
  pulse: 'pulse',
  forecast: 'request-forecast-heading',
  lateRisk: 'risk',
  heatmap: 'heatmap',
  charter: 'charter',
});

const round1 = (value) => Math.round(Number(value) * 10) / 10;

const RISK_META = Object.freeze([
  { key: 'low', apiKey: 'LOW', label: 'Low', description: "Well inside the Citizen's Charter deadline." },
  { key: 'medium', apiKey: 'MEDIUM', label: 'Medium', description: 'Needs steady progress to finish on time.' },
  { key: 'high', apiKey: 'HIGH', label: 'High', description: 'Likely to miss the deadline; follow up first.' },
]);

export async function fetchOfficeModels(officeId, fetcher = apiFetch) {
  if (!officeId) {
    return {
      modelOfficeId: '',
      lateRisk: { state: 'pick', value: null, message: '' },
      forecast: { state: 'pick', value: null, message: '' },
    };
  }
  const [riskRes, forecastRes] = await Promise.allSettled([
    getOfficeLateRisk(officeId, fetcher),
    getOfficeForecast(officeId, fetcher),
  ]);
  return {
    modelOfficeId: officeId,
    lateRisk: riskRes.status === 'fulfilled'
      ? { state: 'ok', value: riskRes.value, message: '' }
      : { state: 'error', value: null, message: riskRes.reason?.message || 'Late-risk predictions are unavailable right now.' },
    forecast: forecastRes.status === 'fulfilled'
      ? { state: 'ok', value: forecastRes.value, message: '' }
      : { state: 'error', value: null, message: forecastRes.reason?.message || 'Could not load the forecast.' },
  };
}

/** Fetches the main Dashboard analytics overview and, once an office target is known, the office-level models. */
export async function getDashboardAnalytics({ period = 'monthly', officeId = '', fallbackModelOffice = '' } = {}, fetcher = apiFetch) {
  const overview = await getInsightsOverview({ period, officeId }, fetcher);
  const targetModelOffice = officeId || overview?.scope?.office_id || fallbackModelOffice || '';
  const models = await fetchOfficeModels(targetModelOffice, fetcher);
  return { overview, ...models };
}

/** Normalizes Oversight's 6-month compliance trend for ComplianceTrendChart. */
export function dashboardTrendPulse(overview) {
  const pulse = overview?.pulse ?? {};
  const trend = Array.isArray(pulse.trend)
    ? pulse.trend.map((p, i) => ({
      period: p.period ?? `m${i}`,
      label: p.label ?? p.period ?? `M${i + 1}`,
      value: p.value === null || p.value === undefined ? null : Number(p.value),
    }))
    : [];
  const current = pulse.on_time_rate ?? null;
  const previous = pulse.previous_on_time_rate ?? null;
  const change = current !== null && previous !== null ? round1(current - previous) : null;
  return { current, previous, change, trend };
}

/** Builds the 4 top KPI summary cards from live Oversight pulse + Operations late-risk counts. */
export function dashboardKpis({ overview, lateRisk }) {
  const pulse = overview?.pulse;
  if (!pulse) return [];
  const highCount = lateRisk?.state === 'ok'
    ? (lateRisk.value?.items ?? []).filter((item) => item.level === 'HIGH').length
    : null;
  const highNote = lateRisk?.state === 'error'
    ? 'Deadline risk unavailable'
    : lateRisk?.state === 'pick'
      ? 'Select an office'
      : highCount === 0
        ? 'No open high-risk transactions'
        : 'In selected office';

  return [
    {
      key: 'ontime',
      label: 'On-time compliance',
      value: pulse.on_time_rate ?? null,
      unit: '%',
      previous: pulse.previous_on_time_rate ?? null,
    },
    {
      key: 'completed',
      label: completedKpiLabel(overview?.period),
      value: pulse.results ?? 0,
      unit: '',
      previous: pulse.previous_results ?? null,
      note: pulse.previous_results == null ? `${pulse.completed_today ?? 0} finished today` : undefined,
    },
    {
      key: 'open',
      label: 'Open transactions',
      value: pulse.open_now ?? 0,
      unit: '',
      previous: null,
      note: pulse.oldest_open_age_minutes != null
        ? `Oldest open ${minutesText(pulse.oldest_open_age_minutes)}`
        : `${pulse.received_today ?? 0} received today`,
    },
    {
      key: 'high_risk',
      label: 'High deadline risk',
      value: highCount,
      unit: '',
      previous: null,
      tone: highCount ? 'danger' : 'default',
      note: highNote,
    },
  ];
}

/** Adapts Operations /api/operations/analytics/late-risk response for LateRiskPanel / RiskBars. */
export function dashboardLateRisk({ lateRisk, officeName = '' } = {}) {
  if (!lateRisk || lateRisk.state === 'idle' || lateRisk.state === 'pick') {
    return { state: 'pick', total: 0, categories: [], stale: false, asOf: null, officeName, message: '' };
  }
  if (lateRisk.state === 'error') {
    return {
      state: 'error',
      total: 0,
      categories: [],
      stale: false,
      asOf: null,
      officeName,
      message: lateRisk.message || 'Deadline risk is unavailable right now.',
    };
  }
  const items = lateRisk.value?.items ?? [];
  const knownKeys = new Set(RISK_META.map((m) => m.apiKey));
  const extraLevels = [...new Set(items.map((i) => String(i?.level ?? '').toUpperCase()).filter((lvl) => lvl && !knownKeys.has(lvl)))];
  const categories = items.length === 0
    ? []
    : [
      ...RISK_META.map((meta) => ({
        key: meta.key,
        label: meta.label,
        count: items.filter((item) => String(item?.level ?? '').toUpperCase() === meta.apiKey).length,
        description: meta.description,
      })),
      ...extraLevels.map((lvl) => ({
        key: lvl.toLowerCase(),
        label: lvl.charAt(0) + lvl.slice(1).toLowerCase(),
        count: items.filter((item) => String(item?.level ?? '').toUpperCase() === lvl).length,
        description: 'Requires immediate attention.',
      })),
    ];
  return {
    state: 'ok',
    total: items.length,
    categories,
    stale: Boolean(lateRisk.value?.stale),
    asOf: lateRisk.value?.as_of ?? null,
    officeName,
    message: '',
  };
}

/** Merges Oversight templates (2-5) with Operations forecast (1) and late-risk (6) for KeyInsightsPanel. */
export function dashboardKeyInsights({ overview, forecast, lateRisk, names = {}, modelOffice = '' } = {}) {
  if (!overview) return [];
  const extra = [
    forecastSentence(forecast?.state === 'ok' ? forecast.value : null, modelOffice),
    highRiskSentence(lateRisk?.state === 'ok' ? lateRisk.value : null),
  ];
  const merged = mergeSentences(overview.sentences ?? [], extra, overview.max_sentences ?? 6);
  const officeName = names.offices?.[modelOffice] || 'selected office';
  const oldestOpen = overview?.pulse?.oldest_open_age_minutes;
  const weeklyTotal = forecast?.state === 'ok' ? forecast.value?.weeklyTotal : null;

  return merged.map((sentence) => {
    const t = sentence.template;
    const n = sentence.params?.n;
    const defaultHref = DASHBOARD_ANCHOR[sentence.chart] ? `#${DASHBOARD_ANCHOR[sentence.chart]}` : null;
    const eyebrow = t === 6
      ? 'Deadline Risk Warning'
      : t === 1
        ? 'Expected Volume'
        : sentence.kind === 'positive'
          ? 'Positive Finding'
          : t === 5
            ? 'Unusual Delay Alert'
            : 'Needs Attention';

    const detail = t === 6
      ? (oldestOpen != null
        ? `Concentrated in ${officeName}. The longest-open transaction has been open for ${minutesText(oldestOpen)}.`
        : `Concentrated in ${officeName}. Follow up on high-risk open transactions before they miss their deadline.`)
      : t === 1
        ? (weeklyTotal != null
          ? `Expected ${Number(weeklyTotal).toLocaleString('en-PH')} requests over the next 5 working days (a projection, not actual volume).`
          : 'A projection for the next 5 working days based on recent volume.')
        : t === 2
          ? 'Service exceeded the 20% late-rate threshold in the selected period.'
          : t === 3
            ? (sentence.params?.direction === 'rose'
              ? 'Office late rate rose between the start and end of the reporting window.'
              : 'Office late rate improved across the reporting window.')
            : t === 4
              ? '9 in 10 transactions completed in under 25% of the Citizen’s Charter time limit.'
              : t === 5
                ? 'These transactions took far longer than is normal for their service.'
                : '';

    const primaryAction = t === 6
      ? { href: '/late-risk', label: `Review ${n ?? ''} High-Risk ${n === 1 ? 'Transaction' : 'Transactions'}`.replace('Review  ', 'Review ').trim() }
      : t === 1
        ? { href: '#request-forecast-heading', label: 'Review Expected Volume' }
        : t === 5
          ? { href: '#unusual', label: 'Review Unusual Delays' }
          : sentence.chart === 'charter'
            ? { href: '#charter', label: 'Check Charter Time Limits' }
            : sentence.chart === 'heatmap'
              ? { href: '#heatmap', label: 'View Office Details' }
              : defaultHref
                ? { href: defaultHref, label: 'See chart' }
                : null;

    const secondaryAction = t === 6 ? { href: '#charter', label: 'Check Charter Time Limits' } : null;

    return {
      id: sentence.id,
      template: t,
      kind: sentence.kind,
      eyebrow,
      text: sentenceText(sentence, names),
      detail,
      href: defaultHref,
      linkLabel: sentence.chart === 'charter' ? 'See charter time limits' : 'See chart',
      primaryAction,
      secondaryAction,
    };
  });
}

/** Normalizes Oversight's 6-month compliance matrix with active catalogue office names and office-bound filtering. */
export function dashboardComplianceHeatmap({ overview, scope, offices = [], names = {} } = {}) {
  const raw = overview?.compliance_heatmap;
  if (!raw || !Array.isArray(raw.periods) || raw.periods.length === 0) {
    return { periods: [], rows: [] };
  }
  const nameMap = { ...names.offices };
  for (const office of offices) {
    if (office?.office_id && office?.office_name) nameMap[office.office_id] = office.office_name;
  }
  const normalized = normalizeHeatmap({
    periods: raw.periods,
    rows: (raw.rows ?? []).map((row) => ({
      ...row,
      office_name: nameMap[row.office_id] ?? 'Office',
    })),
  });

  if (scope?.kind === 'campus' && offices.length > 0) {
    const byId = new Map(normalized.rows.map((row) => [row.officeId, row]));
    for (const office of offices) {
      if (office.is_active === false || byId.has(office.office_id)) continue;
      byId.set(office.office_id, {
        officeId: office.office_id,
        officeName: office.office_name,
        cells: normalized.periods.map((p) => ({ period: p.key, value: null })),
      });
    }
    normalized.rows = [...byId.values()].sort((a, b) => a.officeName.localeCompare(b.officeName));
  } else {
    normalized.rows.sort((a, b) => a.officeName.localeCompare(b.officeName));
  }

  return applyScope({ heatmap: normalized, scope: overview?.scope }, scope).heatmap;
}
