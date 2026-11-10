// Sprint 5 Analytics (Insights), the parts that are not React: who may open it, which offices a person may see, how answers are
// turned into the one shape the charts read, the 60-second refresh and the "Updated hh:mm AM/PM" text. Pure functions so they are
// tested without a browser.
//
// Every data source (the Sprint 6 API and the mock) produces the SAME normalized overview, so charts and the page never know
// which one they are showing:
//
//   {
//     source: 'mock' | 'api',
//     scope:  { kind: 'campus' } | { kind: 'office', officeId },
//     pulse:    { current, previous, change, kpis: [{ key, label, value, unit, previous }], trend: [{ period, label, value }] },
//     forecast: { points: [{ period, label, actual, forecast }], projectedFrom, note },
//     lateRisk: { total, categories: [{ key, label, count, description }] },
//     heatmap:  { periods: [{ key, label }], rows: [{ officeId, officeName, cells: [{ period, value }] }] },
//     insights: [{ id, kind: 'positive' | 'warning' | 'attention', text }],
//   }
import { ROLES } from 'ccms-shared/roles';
import { formatDateTime } from './date-format.js';

export const POLL_INTERVAL_MS = 60_000;

/** Roles that may open Insights (the services decide what each one is sent). */
export const INSIGHTS_ROLES = Object.freeze([ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE, ROLES.SUPER_ADMIN]);

export const canViewInsights = (role) => INSIGHTS_ROLES.includes(role);

/**
 * What a person may see: Office Head and Office Staff only their own office; Executive and Super Admin the whole campus.
 * `ok: false` means an office-bound person has no office on their account, so nothing may be shown (never "everything").
 */
export function insightsScope(user) {
  if (!user || !canViewInsights(user.role)) return { ok: false, kind: 'none', officeId: null };
  if (user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF) {
    return user.officeId ? { ok: true, kind: 'office', officeId: user.officeId } : { ok: false, kind: 'office', officeId: null };
  }
  return { ok: true, kind: 'campus', officeId: null };
}

/** "Updated 2:05 PM" from an ISO date-time, through the Sprint 4 (TT10) Manila formatter. '' when unreadable. */
export function updatedLabel(iso) {
  const full = formatDateTime(iso); // '11/10/2026 2:05 PM'
  const time = full.slice(full.indexOf(' ') + 1);
  return full ? `Updated ${time}` : '';
}

// ---------------------------------------------------------------- normalizers (the adapter's one place that knows answer spellings)

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const list = (v) => (Array.isArray(v) ? v : (v?.items ?? []));

export const RISK_ORDER = Object.freeze(['low', 'medium', 'high', 'critical']);
export const RISK_LABELS = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' });

export function normalizePulse(answer) {
  const trend = list(answer?.trend ?? answer?.history).map((p, i) => ({
    period: text(p.period ?? p.month, `p${i}`),
    label: text(p.label, text(p.period ?? p.month, `P${i + 1}`)),
    value: num(p.value ?? p.compliance ?? p.rate),
  }));
  const withValues = trend.filter((p) => p.value !== null);
  const current = num(answer?.current ?? answer?.compliance) ?? withValues.at(-1)?.value ?? null;
  const previous = num(answer?.previous) ?? withValues.at(-2)?.value ?? null;
  return {
    current,
    previous,
    change: current !== null && previous !== null ? Math.round((current - previous) * 10) / 10 : null,
    kpis: list(answer?.kpis).map((k) => ({ key: text(k.key, text(k.label)), label: text(k.label), value: num(k.value), unit: text(k.unit), previous: num(k.previous) })),
    trend,
  };
}

export function normalizeForecast(answer) {
  const points = list(answer?.points ?? answer?.series).map((p, i) => ({
    period: text(p.period ?? p.month, `p${i}`),
    label: text(p.label, text(p.period ?? p.month, `P${i + 1}`)),
    actual: num(p.actual ?? p.historical),
    forecast: num(p.forecast ?? p.projected),
  }));
  const firstProjected = points.find((p) => p.actual === null && p.forecast !== null);
  return { points, projectedFrom: firstProjected?.label ?? null, note: text(answer?.note) };
}

export function normalizeLateRisk(answer) {
  const byKey = new Map(list(answer?.categories ?? answer?.risks).map((c) => [text(c.key ?? c.category).toLowerCase(), c]));
  const categories = RISK_ORDER.filter((key) => byKey.has(key)).map((key) => {
    const c = byKey.get(key);
    return { key, label: RISK_LABELS[key], count: num(c.count ?? c.total) ?? 0, description: text(c.description) };
  });
  return { total: num(answer?.total) ?? categories.reduce((sum, c) => sum + c.count, 0), categories };
}

export function normalizeHeatmap(answer) {
  const periods = list(answer?.periods).map((p, i) => (typeof p === 'string' ? { key: p, label: p } : { key: text(p.key ?? p.period, `p${i}`), label: text(p.label, text(p.key ?? p.period)) }));
  const rows = list(answer?.rows ?? answer?.offices).map((r) => ({
    officeId: text(r.officeId ?? r.office_id),
    officeName: text(r.officeName ?? r.office_name ?? r.name, 'Office'),
    cells: list(r.cells).map((c) => ({ period: text(c.period), value: num(c.value) })),
  }));
  return { periods, rows };
}

const INSIGHT_KINDS = new Set(['positive', 'warning', 'attention']);
export function normalizeInsights(answer) {
  return list(answer)
    .map((s, i) => (typeof s === 'string' ? { id: `i${i}`, kind: 'attention', text: s } : { id: text(s.id, `i${i}`), kind: INSIGHT_KINDS.has(s.kind ?? s.type) ? (s.kind ?? s.type) : 'attention', text: text(s.text ?? s.sentence) }))
    .filter((s) => s.text);
}

/**
 * Defence in depth: whatever a source returns, an office-bound person never gets another office's heatmap row. The services
 * enforce this too; this keeps a mistake in a source (or in the mock) from reaching the screen.
 */
export function applyScope(overview, scope) {
  if (scope?.kind !== 'office') return overview;
  const rows = overview.heatmap.rows.filter((r) => r.officeId === scope.officeId);
  return { ...overview, scope: { kind: 'office', officeId: scope.officeId }, heatmap: { ...overview.heatmap, rows } };
}

/** The one overview from the five separate answers (or from the mock, which already has this shape). */
export function buildOverview({ pulse, forecast, lateRisk, heatmap, insights }, { source, scope }) {
  return applyScope(
    {
      source,
      scope: scope?.kind === 'office' ? { kind: 'office', officeId: scope.officeId } : { kind: 'campus' },
      pulse: normalizePulse(pulse),
      forecast: normalizeForecast(forecast),
      lateRisk: normalizeLateRisk(lateRisk),
      heatmap: normalizeHeatmap(heatmap),
      insights: normalizeInsights(insights),
    },
    scope,
  );
}

// ---------------------------------------------------------------- heatmap colours (one hue, light to dark, like the CCMS maroon)

/** Value bands for the heatmap, lightest to darkest. A higher compliance is a darker cell; the legend and every cell print the number. */
export const HEAT_BANDS = Object.freeze([
  { min: -Infinity, label: 'Below 60%', bg: '#f6e4e4', fg: '#3d0606' },
  { min: 60, label: '60 to 69%', bg: '#e8bcbc', fg: '#3d0606' },
  { min: 70, label: '70 to 79%', bg: '#d38a8a', fg: '#2a0404' },
  { min: 80, label: '80 to 89%', bg: '#b85555', fg: '#ffffff' },
  { min: 90, label: '90 to 94%', bg: '#9a2a2a', fg: '#ffffff' },
  { min: 95, label: '95% and above', bg: '#800000', fg: '#ffffff' },
]);

export function heatBand(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  let band = HEAT_BANDS[0];
  for (const b of HEAT_BANDS) if (Number(value) >= b.min) band = b;
  return band;
}

// ---------------------------------------------------------------- polling

/**
 * Runs `load` once at start and then every `intervalMs`. Never two at once (a tick that finds one running is skipped), skips ticks
 * while the page is hidden (`isVisible`), and `resumeIfStale()` catches up when the page comes back after more than one interval.
 * Callbacks get every outcome; a failure never throws out of the poller. Timers are injectable so tests need no real waiting.
 */
export function createPoller({ load, onStart, onSuccess, onError, intervalMs = POLL_INTERVAL_MS, isVisible = () => true, timers = { set: (fn, ms) => setInterval(fn, ms), clear: (handle) => clearInterval(handle) }, now = () => Date.now() }) {
  let inFlight = false;
  let handle = null;
  let stopped = true;
  let lastSuccessAt = 0;

  async function run(initial) {
    if (inFlight || stopped) return false;
    inFlight = true;
    onStart?.(initial);
    try {
      const result = await load();
      if (!stopped) {
        lastSuccessAt = now();
        onSuccess?.(result, initial);
      }
    } catch (error) {
      if (!stopped) onError?.(error, initial);
    } finally {
      inFlight = false;
    }
    return true;
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      run(true);
      handle = timers.set(() => {
        if (isVisible()) run(false);
      }, intervalMs);
    },
    stop() {
      stopped = true;
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
    refresh: () => run(false),
    resumeIfStale: () => (now() - lastSuccessAt >= intervalMs ? run(false) : Promise.resolve(false)),
    isRunning: () => inFlight,
  };
}

// ---------------------------------------------------------------- what the screen holds while polling (pure, so it is tested)

export const INITIAL_ANALYTICS_STATE = Object.freeze({ status: 'loading', data: null, lastUpdated: null, refreshing: false, refreshError: null, error: null });

/** A later refresh begins: keep everything, show the subtle refreshing mark. The first load keeps the full loading state. */
export const refreshStarted = (state, initial) => (initial ? state : { ...state, refreshing: true });

/** An answer arrived: it replaces the data, stamps the time of this success and clears any earlier refresh problem. */
export const loaded = (state, data, nowIso) => ({ status: 'ready', data, lastUpdated: nowIso, refreshing: false, refreshError: null, error: null });

/**
 * A call failed. After a first success the last good data and its timestamp stay and only a refresh message is added; before any
 * success the screen shows the error. The sample data is never swapped in here.
 */
export function failed(state, error, initial) {
  const message = error?.message || 'The latest refresh failed.';
  if (state.data && !initial) return { ...state, refreshing: false, refreshError: message };
  return { ...INITIAL_ANALYTICS_STATE, status: 'error', error: error?.message || 'The insights could not be loaded.' };
}
