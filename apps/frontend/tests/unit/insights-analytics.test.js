// Sprint 5 Analytics, now part of the Dashboard. Data paths, scope, polling and state are tested on the pure code; the screens are checked
// from source (there is no browser here). The Sprint 6 APIs do not exist, so the "API provider" is tested against a fake fetcher.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { isRoleAllowed } from '../../src/lib/auth/guards.js';
import { ANALYTICS_PATHS, getAnalyticsOverview, isMockAnalytics, loadAnalytics } from '../../src/lib/api/analytics.js';
import { getMockAnalytics } from '../../src/lib/api/analytics-mock.js';
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
const dashboardFiles = () => readdirSync(root('src/components/dashboard')).map((f) => `src/components/dashboard/${f}`);
// Everything the Dashboard's analytics are written in, as one text (for source checks).
const dashboardSource = () => dashboardFiles().map(read).join('\n');
const NOW = '2026-11-10T06:05:00Z'; // 2:05 PM in Asia/Manila
const CAMPUS = { ok: true, kind: 'campus', officeId: null };
const OFFICE = { ok: true, kind: 'office', officeId: 'office-1' };

describe('who may open Insights (AC1)', () => {
  it('Office Head, Office Staff, Executive and Super Admin only', () => {
    assert.deepEqual([...INSIGHTS_ROLES].sort(), [ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.SUPER_ADMIN].sort());
    for (const role of ROLE_LIST) assert.equal(canViewInsights(role), INSIGHTS_ROLES.includes(role), role);
    for (const role of ['admin', 'SUPER_ADMIN', '', null, undefined, 'citizen']) assert.equal(canViewInsights(role), false, String(role));
  });

  it('the page is limited by the app shell, which renders the page only for an allowed role (no data is requested otherwise)', () => {
    assert.match(read('src/lib/ui/analytics.js'), /export const canViewInsights/);
    assert.match(read('src/app/page.js'), /<DashboardAnalytics user=\{user\} \/>/);
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
  it('has no separate Insights item for any role: analytics live in the Dashboard', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.ok(!nav.some((item) => /insights/i.test(item.label) || item.href === '/insights'), role);
      assert.equal(nav.filter((item) => item.href === '/').length, 1, `${role}: exactly one Dashboard entry`);
      assert.equal(new Set(nav.map((item) => item.href)).size, nav.length, `${role}: no duplicated entries`);
    }
    assert.deepEqual(appNavForRole('admin'), []);
  });

  it('the Insights page, its icon and its menu helper are gone, and an old /insights link goes to the Dashboard', () => {
    assert.ok(!readdirSync(root('src/app')).includes('insights'));
    assert.doesNotMatch(read('src/lib/auth/permissions.js'), /insightsNav/);
    assert.doesNotMatch(read('src/components/layout/NavIcon.js'), /insights/);
    assert.match(read('next.config.js'), /source: '\/insights', destination: '\/'/);
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

  it('the mock gives an office-bound person only their office, and the campus several', () => {
    const own = getMockAnalytics(OFFICE, { now: NOW });
    assert.deepEqual(own.heatmap.rows.map((r) => r.officeId), ['office-1']);
    assert.equal(own.scope.kind, 'office');
    assert.ok(getMockAnalytics(CAMPUS, { now: NOW }).heatmap.rows.length > 1);
    assert.ok(!own.insights.some((i) => /Sample Office/.test(i.text)), 'no other office is named in an office-scoped sentence');
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

describe('mock data provider', () => {
  const mock = getMockAnalytics(CAMPUS, { now: NOW });

  it('has the normalized shape with 12 months of history and 3 projected months', () => {
    assert.equal(mock.source, 'mock');
    assert.equal(mock.pulse.trend.length, 12);
    assert.equal(mock.forecast.points.length, 15);
    assert.equal(mock.forecast.points.filter((p) => p.actual === null && p.forecast !== null).length, 3);
    assert.equal(mock.pulse.trend.at(-1).label, 'Nov 2026');
    assert.equal(mock.forecast.projectedFrom, 'Dec 2026');
    assert.deepEqual(mock.lateRisk.categories.map((c) => c.key), ['low', 'medium', 'high', 'critical']);
    assert.equal(mock.lateRisk.categories.reduce((s, c) => s + c.count, 0), mock.lateRisk.total);
    assert.ok(mock.pulse.kpis.length >= 3 && mock.insights.length >= 3);
  });

  it('joins history and projection at the last actual value, and is deterministic', () => {
    const joint = mock.forecast.points[11];
    assert.equal(joint.actual, joint.forecast);
    assert.deepEqual(getMockAnalytics(CAMPUS, { now: NOW }), mock);
  });

  it('is marked as sample data in every sentence and never claims to be a finding', () => {
    for (const s of mock.insights) assert.match(s.text, /sample/i);
  });

  it('is built from the same pieces as the API path: re-normalizing it changes nothing', () => {
    const again = buildOverview({ pulse: mock.pulse, forecast: mock.forecast, lateRisk: mock.lateRisk, heatmap: mock.heatmap, insights: mock.insights }, { source: 'mock', scope: CAMPUS });
    assert.deepEqual(again, mock);
  });
});

describe('API data provider (adapter boundary)', () => {
  const answers = {
    [ANALYTICS_PATHS.pulse]: { current: 91, previous: 89.5, trend: [{ period: '2026-10', label: 'Oct 2026', value: 91 }], kpis: [{ label: 'On-time', value: 91, unit: '%' }] },
    [ANALYTICS_PATHS.forecast]: { points: [{ period: '2026-10', label: 'Oct', actual: 91 }, { period: '2026-11', label: 'Nov', forecast: 92 }] },
    [ANALYTICS_PATHS.lateRisk]: { categories: [{ key: 'High', count: 3 }, { key: 'low', count: 9, description: 'ok' }] },
    [ANALYTICS_PATHS.heatmap]: { periods: [{ key: '2026-10', label: 'Oct' }], rows: [{ office_id: 'office-1', office_name: 'A', cells: [{ period: '2026-10', value: 88 }] }] },
    [ANALYTICS_PATHS.insights]: { items: [{ id: 'a', kind: 'positive', text: 'Good.' }, { text: '' }] },
  };
  const calls = [];
  const fakeFetch = async (path) => {
    calls.push(path);
    return answers[path.split('?')[0]];
  };

  it('reads all five answers and returns one normalized overview', async () => {
    calls.length = 0;
    const overview = await getAnalyticsOverview(CAMPUS, fakeFetch);
    assert.equal(calls.length, 5);
    assert.deepEqual(new Set(calls), new Set(Object.values(ANALYTICS_PATHS)));
    assert.equal(overview.source, 'api');
    assert.equal(overview.pulse.change, 1.5);
    assert.equal(overview.forecast.projectedFrom, 'Nov');
    assert.deepEqual(overview.lateRisk.categories.map((c) => [c.key, c.count]), [['low', 9], ['high', 3]]);
    assert.equal(overview.lateRisk.total, 12);
    assert.deepEqual(overview.insights, [{ id: 'a', kind: 'positive', text: 'Good.' }]);
  });

  it('asks for the office when the person is office-bound, and for nothing extra for the campus', async () => {
    calls.length = 0;
    await getAnalyticsOverview(OFFICE, fakeFetch);
    assert.ok(calls.every((c) => c.endsWith('?office_id=office-1')), calls.join());
    calls.length = 0;
    await getAnalyticsOverview(CAMPUS, fakeFetch);
    assert.ok(calls.every((c) => !c.includes('?')), calls.join());
  });

  it('fails as a whole if any one of the five fails (a half-filled screen would mislead)', async () => {
    const broken = async (path) => {
      if (path.includes('/forecast')) throw new Error('forecast down');
      return fakeFetch(path);
    };
    await assert.rejects(getAnalyticsOverview(CAMPUS, broken), /forecast down/);
  });

  it('keeps all analytics access in lib/api/analytics.js: no page or chart calls a service directly', () => {
    const files = [...dashboardFiles(), ...readdirSync(root('src/components/charts')).map((f) => `src/components/charts/${f}`)];
    for (const file of files) {
      const text = read(file);
      assert.doesNotMatch(text, /apiFetch|fetch\(|['"`]\/api\//, file);
      assert.doesNotMatch(text, /analytics-mock/, file);
    }
  });
});

describe('feature flag (AC4)', () => {
  it('true is sample data, false is the API, unset is sample data only outside production', () => {
    assert.equal(isMockAnalytics({ flag: 'true', nodeEnv: 'production' }), true);
    assert.equal(isMockAnalytics({ flag: 'true', nodeEnv: 'development' }), true);
    assert.equal(isMockAnalytics({ flag: 'false', nodeEnv: 'development' }), false);
    assert.equal(isMockAnalytics({ flag: undefined, nodeEnv: 'development' }), true);
    assert.equal(isMockAnalytics({ flag: undefined, nodeEnv: 'production' }), false);
    assert.equal(isMockAnalytics({ flag: 'maybe', nodeEnv: 'production' }), false);
  });

  it('the flag alone switches the source; both give the same overview shape and the page code is the same', async () => {
    let apiCalls = 0;
    const fetcher = async () => {
      apiCalls++;
      return { items: [] };
    };
    const mock = await loadAnalytics(CAMPUS, { env: { flag: 'true', nodeEnv: 'development' }, fetcher, now: NOW });
    assert.equal(apiCalls, 0, 'the sample data path never touches the API');
    const api = await loadAnalytics(CAMPUS, { env: { flag: 'false', nodeEnv: 'development' }, fetcher });
    assert.equal(apiCalls, 5);
    assert.equal(mock.source, 'mock');
    assert.equal(api.source, 'api');
    assert.deepEqual(Object.keys(api), Object.keys(mock));
    for (const key of ['pulse', 'forecast', 'lateRisk', 'heatmap']) assert.deepEqual(Object.keys(api[key]).sort(), Object.keys(mock[key]).sort(), key);
  });

  it('never falls back to sample data when the API fails', async () => {
    const down = async () => {
      throw new Error('API down');
    };
    await assert.rejects(loadAnalytics(CAMPUS, { env: { flag: 'false', nodeEnv: 'production' }, fetcher: down }), /API down/);
    await assert.rejects(loadAnalytics(CAMPUS, { env: { flag: undefined, nodeEnv: 'production' }, fetcher: down }), /API down/);
  });

  it('the flag is read in one file; charts and the page know nothing about it or the mock', () => {
    const flagFiles = [...dashboardFiles(), ...readdirSync(root('src/components/charts')).map((f) => `src/components/charts/${f}`), 'src/lib/ui/useAnalytics.js', 'src/lib/ui/analytics.js'];
    for (const file of flagFiles) assert.doesNotMatch(read(file), /NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA/, file);
    assert.match(read('src/lib/api/analytics.js'), /NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA/);
    assert.match(read('.env.example'), /NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA=/);
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
    for (const id of ['pulse', 'forecast', 'risk', 'heatmap']) assert.match(view, new RegExp(`id="${id}"[\\s\\S]*?emptyMessage=`), id);
    const frame = read('src/components/charts/ChartCard.js');
    assert.match(frame, /role="status"/);
    assert.match(frame, /empty \? \(/);
    assert.match(view, /insights-sentences-empty/);
  });

  it('a trend with only blank values counts as empty', () => {
    assert.equal(normalizePulse({ trend: [{ period: 'a', value: null }, { period: 'b' }] }).trend.filter((p) => p.value !== null).length, 0);
  });
});

describe('chart quality: responsive, accessible, labelled', () => {
  it('charts size to their frame, and wide grids scroll inside theirs', () => {
    for (const file of ['TrendChart.js', 'RiskBars.js']) assert.match(read(`src/components/charts/${file}`), /<ResponsiveContainer width="100%" height="100%">/, file);
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
    assert.match(read('src/components/charts/ChartCard.js'), /View as table/);
    assert.match(read('src/components/charts/RiskBars.js'), /LabelList/);
    const heat = read('src/components/charts/Heatmap.js');
    assert.match(heat, /<Table\s[\s\S]*label=\{caption\}/);
    assert.match(heat, /role="tooltip"/);
    assert.match(heat, /aria-label=\{label\}/);
  });

  it('forecast separates history from projection by shape (dashed line, shaded area), not colour alone', () => {
    const trend = read('src/components/charts/TrendChart.js');
    assert.match(trend, /strokeDasharray=\{s\.dashed/);
    assert.match(trend, /<ReferenceArea/);
    assert.match(dashboardSource(), /label="Projected" dashed/);
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

  it('the about panel explains the indicators, the forecast and late risk, and says development data is illustrative until Sprint 6', () => {
    const view = dashboardSource();
    for (const word of ['Compliance:', 'Forecast:', 'Late risk:', 'Heatmap:', 'illustrative', 'Sprint 6']) assert.ok(view.includes(word), word);
  });
});
