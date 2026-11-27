// Main Dashboard analytics: data adapters, scope, polling, chart primitives, and removal of all mock fallbacks.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { isRoleAllowed } from '../../src/lib/auth/guards.js';
import {
  dashboardComplianceHeatmap,
  dashboardKeyInsights,
  dashboardKpis,
  dashboardLateRisk,
  dashboardTrendPulse,
  fetchOfficeModels,
  getDashboardAnalytics,
} from '../../src/lib/api/analytics.js';
import {
  HEAT_BANDS,
  INITIAL_ANALYTICS_STATE,
  INSIGHTS_ROLES,
  POLL_INTERVAL_MS,
  applyScope,
  buildOverview,
  canViewInsights,
  createPoller,
  failed,
  heatBand,
  insightsScope,
  loaded,
  normalizeForecast,
  normalizeHeatmap,
  normalizeInsights,
  normalizeLateRisk,
  normalizePulse,
  refreshStarted,
  updatedLabel,
} from '../../src/lib/ui/analytics.js';

const root = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), 'utf8');
const dashboardFiles = () => readdirSync(root('src/components/dashboard'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => `src/components/dashboard/${entry.name}`);
// Everything the Dashboard's analytics are written in, as one text (for source checks).
const dashboardSource = () => dashboardFiles().map(read).join('\n');
const CAMPUS = { ok: true, kind: 'campus', officeId: null };
const OFFICE = { ok: true, kind: 'office', officeId: 'office-1' };

describe('who may open Insights (AC1)', () => {
  it('Office Head, Office Staff, Executive and Super Admin only', () => {
    assert.deepEqual([...INSIGHTS_ROLES].sort(), [ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.SUPER_ADMIN].sort());
    for (const role of ROLE_LIST) assert.equal(canViewInsights(role), INSIGHTS_ROLES.includes(role), role);
    for (const role of ['admin', 'SUPER_ADMIN', '', null, undefined, 'citizen']) assert.equal(canViewInsights(role), false, String(role));
  });

  it('restricts Dashboard analytics to INSIGHTS_ROLES via canViewInsights and removes /insights page', () => {
    assert.match(read('src/lib/ui/analytics.js'), /export const canViewInsights/);
    assert.equal(existsSync(root('src/app/insights/page.js')), false);
    assert.match(read('src/components/layout/AppShell.js'), /\{allowed \? \(/);
    for (const role of ['admin', 'citizen', undefined]) assert.equal(isRoleAllowed({ role }, INSIGHTS_ROLES), false);
    for (const role of INSIGHTS_ROLES) assert.equal(isRoleAllowed({ role }, INSIGHTS_ROLES), true);
  });

  it('an unrecognized role is refused a scope', () => {
    assert.equal(insightsScope({ role: 'citizen' }).ok, false);
    assert.equal(insightsScope(null).ok, false);
  });
});

describe('sidebar', () => {
  it('excludes /insights and keeps Dashboard (/), /late-risk, and role menus intact without duplicates', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.equal(nav.some((item) => item.href === '/insights'), false, role);
      assert.equal(nav.some((item) => item.href === '/late-risk'), true, role);
      assert.equal(nav.filter((item) => item.href === '/').length, 1, `${role}: exactly one Dashboard entry`);
      assert.equal(new Set(nav.map((item) => item.href)).size, nav.length, `${role}: no duplicated entries`);
    }
    assert.deepEqual(appNavForRole('admin'), []);
  });

  it('removes /insights route directory, NavIcon mapping, insightsNav helper, and adds no stray redirect', () => {
    assert.equal(readdirSync(root('src/app')).includes('insights'), false);
    assert.doesNotMatch(read('src/lib/auth/permissions.js'), /insightsNav|\/insights/);
    assert.doesNotMatch(read('src/components/layout/NavIcon.js'), /'\/insights'/);
    assert.doesNotMatch(read('next.config.js'), /\/insights/);
  });
});

describe('office scope', () => {
  it('Office Head and Office Staff are scoped to their own office; Executive and Super Admin see the campus', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) assert.deepEqual(insightsScope({ role, officeId: 'office-1' }), OFFICE);
    for (const role of [ROLES.EXECUTIVE, ROLES.SUPER_ADMIN]) assert.deepEqual(insightsScope({ role, officeId: 'ignored' }), CAMPUS);
  });

  it('an office-bound account with no office gets nothing (never "everything")', () => {
    assert.equal(insightsScope({ role: ROLES.OFFICE_STAFF, officeId: null }).ok, false);
    assert.equal(insightsScope({ role: ROLES.OFFICE_HEAD }).ok, false);
  });

  it('drops foreign offices for office-bound users and retains active offices for campus users in the compliance heatmap', () => {
    const overview = {
      scope: { kind: 'campus', office_id: null },
      compliance_heatmap: {
        periods: ['2026-10'],
        rows: [
          { office_id: 'office-1', cells: [{ period: '2026-10', value: 92 }] },
          { office_id: 'office-2', cells: [{ period: '2026-10', value: 78 }] },
        ],
      },
    };
    const offices = [
      { office_id: 'office-1', office_name: 'Registrar', is_active: true },
      { office_id: 'office-2', office_name: 'Cashier', is_active: true },
      { office_id: 'office-3', office_name: 'Admissions', is_active: true },
      { office_id: 'office-4', office_name: 'Archived', is_active: false },
    ];
    const own = dashboardComplianceHeatmap({ overview, scope: OFFICE, offices });
    assert.deepEqual(own.rows.map((r) => [r.officeId, r.officeName]), [['office-1', 'Registrar']]);
    const campus = dashboardComplianceHeatmap({ overview, scope: CAMPUS, offices });
    assert.deepEqual(
      campus.rows.map((r) => [r.officeId, r.officeName]),
      [['office-3', 'Admissions'], ['office-2', 'Cashier'], ['office-1', 'Registrar']],
    );
  });

  it('whatever a source returns, other offices are dropped for an office-bound person', () => {
    const answer = {
      periods: ['2026-10'],
      rows: [
        { office_id: 'office-1', office_name: 'Mine', cells: [{ period: '2026-10', value: 90 }] },
        { office_id: 'office-2', office_name: 'Theirs', cells: [{ period: '2026-10', value: 70 }] },
      ],
    };
    const overview = buildOverview({ heatmap: answer }, { source: 'api', scope: OFFICE });
    assert.deepEqual(overview.heatmap.rows.map((r) => r.officeId), ['office-1']);
    assert.equal(buildOverview({ heatmap: answer }, { source: 'api', scope: CAMPUS }).heatmap.rows.length, 2);
    assert.equal(applyScope({ heatmap: { rows: [{ officeId: 'x' }] } }, CAMPUS).heatmap.rows.length, 1);
  });
});

describe('live Dashboard API adapter boundary (zero mock data)', () => {
  const sampleOverview = {
    scope: { kind: 'office', office_id: 'office-1' },
    pulse: {
      on_time_rate: 91,
      previous_on_time_rate: 89.5,
      results: 120,
      previous_results: 100,
      open_now: 14,
      oldest_open_age_minutes: 95,
      trend: [
        { period: '2026-10', label: 'Oct 2026', value: 89.5 },
        { period: '2026-11', label: 'Nov 2026', value: 91 },
      ],
    },
    sentences: [
      { id: 'c1', kind: 'warning', template: 'service_lag', params: { service_id: 'srv-1', late_rate: 25 }, chart: 'charter' },
    ],
    compliance_heatmap: {
      periods: ['2026-10', '2026-11'],
      rows: [{ office_id: 'office-1', cells: [{ period: '2026-10', value: 89.5 }, { period: '2026-11', value: 91 }] }],
    },
    about: { completed_rows: 120, late_cases: 10 },
  };
  const sampleRisk = {
    office_id: 'office-1',
    as_of: '2026-11-10T06:00:00Z',
    stale: false,
    items: [
      { transaction_id: 't1', level: 'HIGH' },
      { transaction_id: 't2', level: 'MEDIUM' },
      { transaction_id: 't3', level: 'LOW' },
    ],
  };
  const sampleForecast = {
    status: 'SUCCESS',
    officeId: 'office-1',
    weeklyTotal: 42,
    history: [
      { date: '2026-11-05', label: '11-05', count: 6 },
      { date: '2026-11-06', label: '11-06', count: 6 },
      { date: '2026-11-07', label: '11-07', count: 6 },
      { date: '2026-11-08', label: '11-08', count: 6 },
      { date: '2026-11-09', label: '11-09', count: 6 },
    ],
    forecast: [{ date: '2026-11-11', label: '11-11', point: 9, lower: 6, upper: 12 }],
  };

  it('fetches Oversight overview once plus per-office Operations models without duplicates', async () => {
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('/api/logs/analytics/insights/overview')) return sampleOverview;
      if (url.startsWith('/api/operations/analytics/late-risk')) return sampleRisk;
      if (url.startsWith('/api/operations/analytics/forecast')) return sampleForecast;
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await getDashboardAnalytics({ period: 'monthly', officeId: 'office-1' }, fakeFetch);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].startsWith('/api/logs/analytics/insights/overview?period=monthly&office_id=office-1'));
    assert.equal(result.modelOfficeId, 'office-1');
    assert.equal(result.lateRisk.state, 'ok');
    assert.equal(result.forecast.state, 'ok');

    const pulse = dashboardTrendPulse(result.overview);
    assert.equal(pulse.current, 91);
    assert.equal(pulse.change, 1.5);
    assert.equal(pulse.trend.length, 2);

    const kpis = dashboardKpis({ overview: result.overview, lateRisk: result.lateRisk });
    assert.equal(kpis.length, 4);
    assert.equal(kpis[3].value, 1);
    assert.equal(kpis[3].tone, 'danger');

    const riskView = dashboardLateRisk({ lateRisk: result.lateRisk, officeName: 'Registrar' });
    assert.deepEqual(riskView.categories.map((c) => [c.key, c.count]), [['low', 1], ['medium', 1], ['high', 1]]);

    const extraRiskView = dashboardLateRisk({
      lateRisk: { state: 'ok', value: { items: [{ level: 'HIGH' }, { level: 'CRITICAL' }] } },
    });
    assert.deepEqual(extraRiskView.categories.map((c) => [c.key, c.count]), [['low', 0], ['medium', 0], ['high', 1], ['critical', 1]]);

    const insights = dashboardKeyInsights({
      overview: result.overview,
      forecast: result.forecast,
      lateRisk: result.lateRisk,
      names: { services: { 'srv-1': 'TOR Request' }, offices: { 'office-1': 'Registrar' } },
      modelOffice: 'office-1',
    });
    assert.ok(insights.some((i) => i.href === '#charter'));
    assert.ok(insights.some((i) => i.href === '#request-forecast-heading'));
    assert.ok(insights.some((i) => i.eyebrow === 'Deadline Risk Warning' && i.primaryAction?.href === '/late-risk'));
  });

  it('labels the completed KPI with the selected period and never calls deadline risk "overdue"', () => {
    const pulse = { on_time_rate: 90, results: 12, open_now: 3 };
    const completedLabel = (period) => dashboardKpis({ overview: { pulse, period }, lateRisk: { state: 'pick' } })[1].label;
    assert.equal(completedLabel('weekly'), 'Completed this week');
    assert.equal(completedLabel('monthly'), 'Completed this month');
    assert.equal(completedLabel('half_year'), 'Completed this half-year');
    assert.equal(completedLabel('annual'), 'Completed this year');
    assert.equal(completedLabel('custom'), 'Completed in this period');
    assert.equal(completedLabel(undefined), 'Completed in this period');

    const kpis = dashboardKpis({ overview: { pulse, period: 'monthly' }, lateRisk: { state: 'ok', value: { items: [{ level: 'HIGH' }] } } });
    assert.equal(kpis[2].label, 'Open transactions');
    assert.equal(kpis[3].label, 'High deadline risk');
    assert.doesNotMatch(JSON.stringify(kpis), /overdue|breach/i);
  });

  it('propagates overview failure cleanly and isolates individual model failures without mock fallback', async () => {
    const failOverview = async () => {
      throw new Error('Oversight unreachable');
    };
    await assert.rejects(getDashboardAnalytics({ period: 'monthly' }, failOverview), /Oversight unreachable/);

    const failRisk = async (url) => {
      if (url.includes('/late-risk')) throw new Error('Late-risk unavailable');
      return sampleForecast;
    };
    const partial = await fetchOfficeModels('office-1', failRisk);
    assert.equal(partial.lateRisk.state, 'error');
    assert.equal(partial.lateRisk.message, 'Late-risk unavailable');
    assert.equal(partial.forecast.state, 'ok');
    const riskErrView = dashboardLateRisk({ lateRisk: partial.lateRisk });
    assert.equal(riskErrView.state, 'error');
    assert.deepEqual(riskErrView.categories, []);
  });

  it('purges mock analytics modules, sample env flags, /insights page files, and chart-level API fetches', () => {
    assert.equal(existsSync(root('src/lib/api/analytics-mock.js')), false);
    assert.equal(existsSync(root('src/components/dashboard/ComplianceForecastChart.js')), false);
    assert.equal(existsSync(root('src/app/insights/page.js')), false);
    assert.equal(existsSync(root('src/components/insights/InsightsPage.js')), false);
    for (const file of [
      'src/lib/api/analytics.js',
      'src/lib/ui/useAnalytics.js',
      'src/lib/ui/analytics.js',
      '.env.example',
      ...dashboardFiles(),
    ]) {
      assert.doesNotMatch(read(file), /NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA|analytics-mock|getMockAnalytics|isMockAnalytics/, file);
    }
    for (const file of readdirSync(root('src/components/charts')).map((f) => `src/components/charts/${f}`)) {
      assert.doesNotMatch(read(file), /apiFetch|fetch\(|['"`]\/api\//, file);
    }
  });
});

describe('polling every 60 seconds (AC3)', () => {
  function fakeClock() {
    const timers = { handle: null, fn: null, interval: null, cleared: 0, set: (fn, ms) => ((timers.fn = fn), (timers.interval = ms), (timers.handle = 1)), clear: () => { timers.cleared++; timers.handle = null; } };
    return timers;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('the interval is 60 seconds', () => assert.equal(POLL_INTERVAL_MS, 60_000));

  it('the default timers are wrapped: a browser throws "Illegal invocation" if setInterval is called as a method of another object', () => {
    assert.doesNotMatch(read('src/lib/ui/analytics.js'), /set: setInterval|clear: clearInterval/);
    assert.match(read('src/lib/ui/analytics.js'), /set: \(fn, ms\) => setInterval\(fn, ms\)/);
  });

  it('loads at once, then on every tick, using the 60-second timer', async () => {
    const t = fakeClock();
    let loads = 0;
    const events = [];
    const poller = createPoller({ load: async () => ++loads, onStart: (i) => events.push(['start', i]), onSuccess: (r, i) => events.push(['ok', r, i]), timers: t });
    poller.start();
    await tick();
    assert.equal(t.interval, 60_000);
    assert.equal(loads, 1);
    t.fn();
    await tick();
    assert.equal(loads, 2);
    assert.deepEqual(events, [['start', true], ['ok', 1, true], ['start', false], ['ok', 2, false]]);
  });

  it('never runs two requests at once', async () => {
    const t = fakeClock();
    let release;
    let loads = 0;
    const poller = createPoller({ load: () => (loads++, new Promise((r) => (release = r))), timers: t });
    poller.start();
    t.fn();
    t.fn();
    await poller.refresh();
    assert.equal(loads, 1);
    assert.equal(poller.isRunning(), true);
    release();
    await tick();
    t.fn();
    assert.equal(loads, 2);
  });

  it('skips ticks while the page is hidden and catches up when it returns after a full interval', async () => {
    const t = fakeClock();
    let visible = false;
    let clock = 0;
    let loads = 0;
    const poller = createPoller({ load: async () => ++loads, isVisible: () => visible, timers: t, now: () => clock });
    poller.start();
    await tick();
    assert.equal(loads, 1);
    clock = 30_000;
    t.fn();
    await tick();
    assert.equal(loads, 1, 'hidden: no request');
    await poller.resumeIfStale();
    assert.equal(loads, 1, 'returned before a full interval: no request');
    clock = 61_000;
    await poller.resumeIfStale();
    assert.equal(loads, 2, 'returned after a full interval: refreshes now');
  });

  it('stop() clears the timer and ignores a late answer (unmount cleanup)', async () => {
    const t = fakeClock();
    let release;
    const seen = [];
    const poller = createPoller({ load: () => new Promise((r) => (release = r)), onSuccess: (r) => seen.push(r), timers: t });
    poller.start();
    poller.stop();
    assert.equal(t.cleared, 1);
    assert.equal(t.handle, null);
    release('late');
    await tick();
    assert.deepEqual(seen, []);
    assert.equal(await poller.refresh(), false, 'a stopped poller starts nothing');
  });

  it('the hook clears its listener and timer on unmount, and the page shows "Updated"', () => {
    const hook = read('src/lib/ui/useAnalytics.js');
    assert.match(hook, /removeEventListener\('visibilitychange'/);
    assert.match(hook, /poller\.stop\(\)/);
    assert.match(dashboardSource(), /updatedLabel\(lastUpdated\)/);
  });
});

describe('timestamp uses the TT10 helpers (AC3)', () => {
  it('shows Updated h:mm AM/PM in Manila time', () => {
    assert.equal(updatedLabel('2026-11-10T06:05:00Z'), 'Updated 2:05 PM');
    assert.equal(updatedLabel('2026-11-10T00:07:00Z'), 'Updated 8:07 AM');
    assert.equal(updatedLabel('2026-11-10T16:00:00Z'), 'Updated 12:00 AM');
    assert.equal(updatedLabel('2026-11-10T04:00:00Z'), 'Updated 12:00 PM');
    assert.match(updatedLabel('2026-11-10T06:05:00Z'), /^Updated \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('is empty for an unreadable or offset-less value, and has no second time-zone routine of its own', () => {
    assert.equal(updatedLabel(null), '');
    assert.equal(updatedLabel('not a date'), '');
    assert.equal(updatedLabel('2026-11-10T06:05:00'), '');
    for (const file of ['src/lib/ui/analytics.js', 'src/lib/api/analytics.js', ...dashboardFiles()]) {
      assert.doesNotMatch(read(file), /toLocale(Time|Date)String|Intl\.DateTimeFormat|getTimezoneOffset|getHours\(|MANILA_OFFSET/, file);
    }
    assert.match(read('src/lib/ui/analytics.js'), /from '\.\/date-format\.js'/);
  });
});

describe('a failed refresh keeps what is shown', () => {
  const data = { source: 'api' };
  const ready = loaded(INITIAL_ANALYTICS_STATE, data, '2026-11-10T06:05:00Z');

  it('shows the loading state first, then the data with its time', () => {
    assert.equal(INITIAL_ANALYTICS_STATE.status, 'loading');
    assert.deepEqual([ready.status, ready.data, ready.lastUpdated, ready.refreshing], ['ready', data, '2026-11-10T06:05:00Z', false]);
  });

  it('a later refresh shows the subtle refreshing mark without touching the data', () => {
    const refreshing = refreshStarted(ready, false);
    assert.equal(refreshing.refreshing, true);
    assert.equal(refreshing.data, data);
    assert.equal(refreshStarted(INITIAL_ANALYTICS_STATE, true), INITIAL_ANALYTICS_STATE);
  });

  it('a failed refresh keeps the last good data and timestamp and adds a message', () => {
    const after = failed(refreshStarted(ready, false), new Error('Cannot reach the server.'), false);
    assert.equal(after.status, 'ready');
    assert.equal(after.data, data);
    assert.equal(after.lastUpdated, '2026-11-10T06:05:00Z');
    assert.equal(after.refreshing, false);
    assert.equal(after.refreshError, 'Cannot reach the server.');
  });

  it('the next success clears the problem and moves the timestamp; a failure before any success is an error screen', () => {
    const recovered = loaded(failed(ready, new Error('x'), false), { source: 'api', n: 2 }, '2026-11-10T06:06:00Z');
    assert.equal(recovered.refreshError, null);
    assert.equal(recovered.lastUpdated, '2026-11-10T06:06:00Z');
    const first = failed(INITIAL_ANALYTICS_STATE, new Error('No access.'), true);
    assert.deepEqual([first.status, first.error, first.data], ['error', 'No access.', null]);
  });

  it('the page says which update the figures are from', () => {
    assert.match(dashboardSource(), /The latest refresh failed/);
  });
});

describe('chart empty states and the answers behind them', () => {
  it('empty answers normalize to empty charts, not errors', () => {
    assert.deepEqual(normalizePulse(null).trend, []);
    assert.equal(normalizePulse(null).current, null);
    assert.deepEqual(normalizeForecast(null).points, []);
    assert.deepEqual(normalizeLateRisk(null), { total: 0, categories: [] });
    assert.deepEqual(normalizeHeatmap(null), { periods: [], rows: [] });
    assert.deepEqual(normalizeInsights(null), []);
  });

  it('every chart on the page has its own empty message and the shared frame shows it instead of the plot', () => {
    const view = dashboardSource();
    for (const id of ['pulse', 'risk', 'heatmap']) assert.match(view, new RegExp(`id="${id}"[\\s\\S]*?emptyMessage=`), id);
    const frame = read('src/components/charts/ChartCard.js');
    assert.match(frame, /role="status"/);
    assert.match(frame, /empty \? \(/);
    assert.match(view, /forecast-empty/);
    assert.match(view, /forecast-not-enough-history/);
    assert.match(view, /insights-sentences-empty/);
  });

  it('a trend with only blank values counts as empty', () => {
    assert.equal(normalizePulse({ trend: [{ period: 'a', value: null }, { period: 'b' }] }).trend.filter((p) => p.value !== null).length, 0);
  });
});

describe('chart quality: responsive, accessible, labelled', () => {
  it('charts size to their frame, and wide grids scroll inside theirs', () => {
    for (const file of ['TrendChart.js', 'RiskBars.js']) assert.match(read(`src/components/charts/${file}`), /<ResponsiveContainer width="100%" height="100%">/, file);
    assert.match(read('src/components/dashboard/RequestForecastChart.js'), /<ResponsiveContainer width="100%" height="100%">/);
    assert.match(read('src/components/ui/TableShell.js'), /overflow-x-auto/);
    assert.match(read('src/components/charts/Heatmap.js'), /<Table\s/);
    const view = dashboardSource();
    assert.match(view, /grid gap-4 lg:grid-cols-4/);
    assert.match(view, /lg:grid-cols-2/);
  });

  it('every chart has a text label, a tooltip, a legend or direct labels, and a table view; there is no animation', () => {
    for (const file of ['TrendChart.js', 'RiskBars.js']) {
      const text = read(`src/components/charts/${file}`);
      assert.match(text, /role="img" aria-label=\{ariaLabel\}/, file);
      assert.match(text, /<Tooltip/, file);
      assert.match(text, /isAnimationActive=\{false\}/, file);
    }
    const fcChart = read('src/components/dashboard/RequestForecastChart.js');
    assert.match(fcChart, /role="img" aria-label=/);
    assert.match(fcChart, /<Tooltip/);
    assert.match(fcChart, /isAnimationActive=\{false\}/);
    assert.match(read('src/components/charts/ChartCard.js'), /View as table/);
    assert.match(read('src/components/dashboard/RequestForecastSection.js'), /View as table/);
    assert.match(read('src/components/charts/RiskBars.js'), /LabelList/);
    const heat = read('src/components/charts/Heatmap.js');
    assert.match(heat, /<Table\s[\s\S]*label=\{caption\}/);
    assert.match(heat, /role="tooltip"/);
    assert.match(heat, /aria-label=\{label\}/);
  });

  it('forecast separates history from projection by shape (dashed line, shaded band), not colour alone', () => {
    const trend = read('src/components/charts/TrendChart.js');
    assert.match(trend, /strokeDasharray=\{s\.dashed/);
    assert.match(trend, /<ReferenceArea/);
    const fcChart = read('src/components/dashboard/RequestForecastChart.js');
    assert.match(fcChart, /strokeDasharray="5 4"/);
    assert.match(fcChart, /<ReferenceLine/);
    assert.match(fcChart, /<Area[\s\S]*dataKey="upper"/);
  });

  it('heatmap bands are one hue, light to dark, and every value is also printed', () => {
    assert.equal(HEAT_BANDS.length, 6);
    assert.equal(heatBand(null), null);
    assert.equal(heatBand(59.9), HEAT_BANDS[0]);
    assert.equal(heatBand(60), HEAT_BANDS[1]);
    assert.equal(heatBand(89.9), HEAT_BANDS[3]);
    assert.equal(heatBand(100), HEAT_BANDS[5]);
    assert.equal(HEAT_BANDS.at(-1).bg, '#800000');
    const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    for (let i = 1; i < HEAT_BANDS.length; i++) assert.ok(lum(HEAT_BANDS[i].bg) < lum(HEAT_BANDS[i - 1].bg), 'each band is darker than the one before');
  });
});

describe('library and about panel (AC2)', () => {
  it('Recharts is pinned to an exact version in the frontend package.json', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.dependencies.recharts, /^\d+\.\d+\.\d+$/);
    assert.doesNotMatch(pkg.dependencies.recharts, /[\^~><*xX]/);
  });

  it('the about panel explains the indicators, forecast, late risk, heatmap, and live data limitations without mock disclaimers', () => {
    const about = read('src/components/dashboard/AboutAnalyticsPanel.js');
    for (const word of ['On-time compliance:', 'Expected request volume:', 'Deadline risk:', 'Office performance:', 'Data limitations:', 'seededHistoryDisclosure']) assert.ok(about.includes(word), word);
    assert.doesNotMatch(about, /illustrative|Sprint 6/i);
  });
});
