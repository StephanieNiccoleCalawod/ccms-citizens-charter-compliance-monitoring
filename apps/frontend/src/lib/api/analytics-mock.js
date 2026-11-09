// ILLUSTRATIVE SAMPLE DATA for Insights while the Sprint 6 analytics APIs do not exist. Nothing here is a real measurement, a
// real office or a real finding. analytics.js is the only file that uses this, and only when the data-source flag asks for it.
//
// It returns the same normalized overview as the API path (see lib/ui/analytics.js), built for the scope it is asked for, so an
// office-bound person's sample holds one office and never the others. It is deterministic: the same office gives the same numbers.
import { formatDateTime } from '../ui/date-format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SAMPLE_OFFICES = ['Sample Office A', 'Sample Office B', 'Sample Office C', 'Sample Office D', 'Sample Office E', 'Sample Office F'];
const HISTORY = 12;
const AHEAD = 3;

function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return (h % 10_000) / 10_000;
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo = 40, hi = 99.5) => Math.min(hi, Math.max(lo, n));

/** The months to show, ending with the current Manila month (read through the shared TT10 formatter, not a second time-zone routine). */
function periodsEndingAt(nowIso, back, ahead) {
  const [month, , year] = formatDateTime(nowIso).split(' ')[0].split('/').map(Number);
  const base = (Number.isFinite(year) ? year : 2026) * 12 + ((Number.isFinite(month) ? month : 1) - 1);
  const make = (offset) => {
    const index = base + offset;
    const y = Math.floor(index / 12);
    const m = index % 12;
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
  };
  return { history: Array.from({ length: back }, (_, i) => make(i - back + 1)), ahead: Array.from({ length: ahead }, (_, i) => make(i + 1)) };
}

function officeSeries(officeId, count) {
  const rand = seeded(officeId);
  let level = 66 + rand() * 26;
  const drift = (rand() - 0.4) * 1.6;
  return Array.from({ length: count }, () => {
    level = clamp(level + drift + (rand() - 0.5) * 6);
    return round1(level);
  });
}

export function getMockAnalytics(scope, { now = new Date().toISOString() } = {}) {
  const { history, ahead } = periodsEndingAt(now, HISTORY, AHEAD);
  const offices =
    scope?.kind === 'office'
      ? [{ officeId: scope.officeId, officeName: 'Your office (sample)' }]
      : SAMPLE_OFFICES.map((name, i) => ({ officeId: `sample-office-${i + 1}`, officeName: name }));

  const perOffice = offices.map((o) => ({ ...o, values: officeSeries(o.officeId, HISTORY) }));
  const overall = history.map((_, i) => round1(perOffice.reduce((sum, o) => sum + o.values[i], 0) / perOffice.length));
  const current = overall.at(-1);
  const previous = overall.at(-2);

  // A plain straight-line projection of the last six months; a sample, not a model.
  const recent = overall.slice(-6);
  const slope = (recent.at(-1) - recent[0]) / (recent.length - 1);
  const projected = ahead.map((_, i) => round1(clamp(current + slope * (i + 1))));

  const scale = scope?.kind === 'office' ? 1 : perOffice.length;
  const completed = Math.round(310 * scale * (current / 90));
  const open = Math.round(64 * scale);
  const late = Math.round(open * ((100 - current) / 100) * 2.2);
  const risk = { low: Math.round(open * 0.46), medium: Math.round(open * 0.31), high: Math.round(open * 0.16), critical: 0 };
  risk.critical = Math.max(0, open - risk.low - risk.medium - risk.high);

  const lowest = [...perOffice].sort((a, b) => a.values.at(-1) - b.values.at(-1))[0];
  const insights = [];
  insights.push(
    current >= previous
      ? { id: 'trend', kind: 'positive', text: `Compliance is ${current}%, up ${round1(current - previous)} points from last month (sample data).` }
      : { id: 'trend', kind: 'warning', text: `Compliance is ${current}%, down ${round1(previous - current)} points from last month (sample data).` },
  );
  insights.push({ id: 'risk', kind: risk.high + risk.critical > 0 ? 'warning' : 'positive', text: `${risk.high + risk.critical} open transactions are at high or critical late risk (sample data).` });
  if (scope?.kind !== 'office') insights.push({ id: 'lowest', kind: 'attention', text: `${lowest.officeName} has the lowest compliance this month at ${lowest.values.at(-1)}% (sample data).` });
  insights.push({ id: 'forecast', kind: projected.at(-1) >= current ? 'positive' : 'attention', text: `If the last six months continue, compliance would reach about ${projected.at(-1)}% by ${ahead.at(-1).label} (sample projection).` });

  return {
    source: 'mock',
    scope: scope?.kind === 'office' ? { kind: 'office', officeId: scope.officeId } : { kind: 'campus' },
    pulse: {
      current,
      previous,
      change: round1(current - previous),
      kpis: [
        { key: 'ontime', label: 'On-time completion', value: current, unit: '%', previous },
        { key: 'completed', label: 'Transactions completed', value: completed, unit: '', previous: Math.round(completed * 0.96) },
        { key: 'open', label: 'Open transactions', value: open, unit: '', previous: Math.round(open * 1.05) },
        { key: 'late', label: 'Completed late', value: late, unit: '', previous: Math.round(late * 0.9) },
      ],
      trend: history.map((p, i) => ({ period: p.key, label: p.label, value: overall[i] })),
    },
    forecast: {
      points: [
        ...history.map((p, i) => ({ period: p.key, label: p.label, actual: overall[i], forecast: i === HISTORY - 1 ? overall[i] : null })),
        ...ahead.map((p, i) => ({ period: p.key, label: p.label, actual: null, forecast: projected[i] })),
      ],
      projectedFrom: ahead[0].label,
      note: 'Sample projection: the last six months continued in a straight line.',
    },
    lateRisk: {
      total: open,
      categories: [
        { key: 'low', label: 'Low', count: risk.low, description: 'Well inside the deadline.' },
        { key: 'medium', label: 'Medium', count: risk.medium, description: 'Needs steady progress to finish on time.' },
        { key: 'high', label: 'High', count: risk.high, description: 'Close to the deadline; follow up soon.' },
        { key: 'critical', label: 'Critical', count: risk.critical, description: 'Likely to finish late without action now.' },
      ],
    },
    heatmap: {
      periods: history.slice(-6).map((p) => ({ key: p.key, label: p.label })),
      rows: perOffice.map((o) => ({ officeId: o.officeId, officeName: o.officeName, cells: history.slice(-6).map((p, i) => ({ period: p.key, value: o.values[HISTORY - 6 + i] })) })),
    },
    insights,
  };
}
