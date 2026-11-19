// Dashboard analytics: live Analytics sit directly inside the signed-in Dashboard (/), reusing shared charts and Oversight/Operations
// models with zero mock data and with the dedicated /insights route permanently removed.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { INSIGHTS_ROLES, insightsScope } from '../../src/lib/ui/analytics.js';

const path = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(path(p), 'utf8');
const container = read('src/components/dashboard/DashboardAnalytics.js');
const page = read('src/app/page.js');

describe('AC1 / AC2: analytics are consolidated in the Dashboard and the service finder is removed from signed-in home', () => {
  it('the signed-in home page renders DashboardAnalytics directly and preserves LandingHero for signed-out visitors', () => {
    assert.match(page, /<AppShell title="Dashboard"/);
    assert.ok(page.indexOf('<DashboardAnalytics user={user} />') > 0);
    for (const removed of ['Find a service', 'id="home-search"', 'data-testid="service-grid"', 'data-testid="service-list"', 'useCatalogue']) {
      assert.equal(page.includes(removed), false, `unexpected service finder remnant: ${removed}`);
    }
    for (const kept of ['<LandingHero />', "mode === 'public'"]) {
      assert.ok(page.includes(kept), `missing public branch: ${kept}`);
    }
  });

  it('no role has an /insights sidebar entry, no entry is duplicated, and all remaining items (including /late-risk) stay intact', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.equal(nav.some((i) => i.href === '/insights'), false, `${role}: /insights removed`);
      assert.equal(nav.some((i) => i.href === '/late-risk'), true, `${role}: /late-risk preserved`);
      assert.equal(new Set(nav.map((i) => i.href)).size, nav.length, `${role}: duplicated entries`);
      assert.ok(['/', '/services', '/calendar'].every((href) => nav.some((i) => i.href === href)), role);
    }
    const labels = (role) => appNavForRole(role).map((i) => i.label);
    assert.ok(['Accounts', 'Offices', 'Registry', 'Logs', 'Transactions'].every((l) => labels(ROLES.SUPER_ADMIN).includes(l)));
    assert.ok(labels(ROLES.OFFICE_STAFF).includes('Transactions'));
  });
});

describe('the sections, in order', () => {
  const order = ['<DashboardHeader', '<ComplianceKpiGrid', '<Tabs', '<ComplianceTrendChart', '<RequestForecastSection', '<LateRiskPanel', '<KeyInsightsPanel', '<ComplianceHeatmap', '<ServiceCharterPanel', '<UnusualCasesPanel', '<AboutAnalyticsPanel'];

  it('header, KPI cards, horizontal analytics tabs, trend and forecast, late risk and key insights, heatmap, charter audit, unusual cases, about', () => {
    const positions = order.map((tag) => container.indexOf(tag));
    assert.ok(positions.every((p) => p > 0), 'every section is used');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'in the agreed order');
  });

  it('renders compact underline dashboard tabs with dynamic badges and right supporting description', () => {
    const tabs = read('src/components/ui/Tabs.js');
    assert.match(container, /variant="analytics"/);
    assert.match(container, /supportingText="Charter check & cell drilldown enabled"/);
    assert.match(container, /dashboardAuditCounts\(/);
    assert.match(container, /buildDashboardTabs\(/);
    assert.match(tabs, /border-\[#800000\][\s\S]*?text-\[#800000\]/);
    assert.match(tabs, /text-\[#64748B\]/);
    assert.match(tabs, /border-\[#E2E8F0\]/);
    assert.match(tabs, /overflow-x-auto/);
    assert.match(tabs, /bg-\[#FEF3C7\][\s\S]*?text-\[#800000\]/);
    assert.match(tabs, /bg-\[#F4F5F8\][\s\S]*?text-\[#64748B\]/);
  });

  it('reuses existing analytics components and removes obsolete mock and /insights page files', () => {
    for (const name of ['DashboardHeader', 'ComplianceKpiGrid', 'ComplianceTrendChart', 'RequestForecastSection', 'RequestForecastChart', 'LateRiskPanel', 'KeyInsightsPanel', 'ComplianceHeatmap', 'ServiceLateRateMatrix', 'ServiceCellDetail', 'ServiceCharterPanel', 'UnusualCasesPanel', 'AboutAnalyticsPanel', 'DashboardAnalytics']) {
      assert.ok(existsSync(path(`src/components/dashboard/${name}.js`)), name);
    }
    const matrix = read('src/components/dashboard/ServiceLateRateMatrix.js');
    assert.match(matrix, /font-serif/);
    assert.match(matrix, /#800000/);
    assert.match(matrix, /#FFDF00/);
    assert.match(matrix, /#F8EEEE/);
    assert.match(matrix, /Services with no transactions this period/);
    assert.match(matrix, /md:grid-cols-2 xl:grid-cols-3/);
    assert.match(matrix, /overflow-x-auto/);
    const charter = read('src/components/dashboard/ServiceCharterPanel.js');
    assert.match(charter, /font-serif/);
    assert.match(charter, /CHARTER_SHOW_OPTIONS/);
    assert.match(charter, /CHARTER_SORT_OPTIONS/);
    assert.match(charter, /<DataTable/);
    assert.match(charter, /<StatusBadge/);
    const trend = read('src/components/dashboard/ComplianceTrendChart.js');
    assert.match(trend, /95% Charter Target/);
    assert.match(trend, /Compare by office/);
    const riskPanel = read('src/components/dashboard/LateRiskPanel.js');
    assert.match(riskPanel, /Risk Distribution/);
    assert.match(riskPanel, /SLA timers exclude non-working holidays/);
    const keyInsights = read('src/components/dashboard/KeyInsightsPanel.js');
    assert.match(keyInsights, /Automated anomalies &amp; SLA alerts/);
    assert.match(keyInsights, /key-insights-badge/);
    assert.equal(existsSync(path('src/lib/api/analytics-mock.js')), false, 'analytics-mock.js removed');
    assert.equal(existsSync(path('src/components/dashboard/ComplianceForecastChart.js')), false, 'ComplianceForecastChart.js removed');
    assert.equal(path('src/app/insights/page.js') && existsSync(path('src/app/insights/page.js')), false, '/insights route removed');
    assert.equal(existsSync(path('src/components/insights/InsightsPage.js')), false, 'InsightsPage.js removed');
  });
});

describe('AC3 to AC7 / AC10: the two-column layout and the responsive rules', () => {
  it('trend and forecast share one two-column row; late risk and key insights share another', () => {
    assert.match(container, /export const TWO_COLUMNS = 'grid items-stretch gap-4 lg:grid-cols-2'/);
    const rows = [...container.matchAll(/<div className=\{TWO_COLUMNS\} data-testid="(charts-row|monitoring-row)">([\s\S]*?)<\/div>/g)];
    assert.deepEqual(rows.map((m) => m[1]), ['charts-row', 'monitoring-row']);
    assert.match(rows[0][2], /<ComplianceTrendChart[\s\S]*<RequestForecastSection/);
    assert.match(rows[1][2], /<LateRiskPanel[\s\S]*<KeyInsightsPanel/);
  });

  it('the four KPI cards share one row on desktop (one column on a phone)', () => {
    const grid = read('src/components/dashboard/ComplianceKpiGrid.js');
    assert.match(grid, /grid gap-4 lg:grid-cols-4/);
    assert.match(grid, /kpis\.slice\(0, 4\)/);
  });

  it('the heatmap is outside both rows (full width) and below them', () => {
    assert.ok(container.indexOf('<ComplianceHeatmap') > container.indexOf('data-testid="monitoring-row"'));
    assert.doesNotMatch(read('src/components/dashboard/ComplianceHeatmap.js'), /grid-cols/);
  });

  it('cards in a row stretch to one height, and chart/forecast cards pin table controls to the bottom', () => {
    assert.match(container, /items-stretch/);
    const frame = read('src/components/charts/ChartCard.js');
    assert.match(frame, /flex h-full flex-col/);
    assert.match(frame, /mt-auto/);
    assert.match(read('src/components/dashboard/KeyInsightsPanel.js'), /flex h-full flex-col/);
    assert.match(read('src/components/dashboard/RequestForecastSection.js'), /embedded \? 'card flex h-full flex-col/);
  });

  it('nothing forces two columns on a phone, and wide content scrolls inside its own frame', () => {
    const all = ['DashboardAnalytics', 'ComplianceKpiGrid', 'LateRiskPanel', 'KeyInsightsPanel'].map((n) => read(`src/components/dashboard/${n}.js`)).join('\n');
    assert.doesNotMatch(all, /(?<![:\w-])grid-cols-[2-9]/);
    assert.match(read('src/components/ui/TableShell.js'), /overflow-x-auto/);
    assert.match(read('src/components/charts/Heatmap.js'), /<Table\s/);
  });
});

describe('the About panel and the header', () => {
  it('About is a collapsed disclosure without mock/Sprint-6 placeholder text', () => {
    const about = read('src/components/dashboard/AboutAnalyticsPanel.js');
    assert.match(about, /<details className=/);
    assert.doesNotMatch(about, /<details[^>]*\sopen/);
    for (const word of ['Compliance:', 'Forecast:', 'Late risk:', 'Heatmap:', 'Data limitations:', 'seededHistoryDisclosure']) assert.ok(about.includes(word), word);
    assert.doesNotMatch(about, /Sprint 6|illustrative|sample/i);
  });

  it('the header shows the scope, the last update in TT10 time, refresh status, and in-page Charter link (no sample badge)', () => {
    const header = read('src/components/dashboard/DashboardHeader.js');
    assert.match(header, /whole campus/);
    assert.match(header, /your office only/);
    assert.match(header, /updatedLabel\(lastUpdated\)/);
    assert.match(header, /Refreshing…/);
    assert.match(header, /Refreshes every minute/);
    assert.match(header, /href="#charter"/);
    assert.doesNotMatch(header, /\/insights/);
    assert.doesNotMatch(header, /source === 'mock'|Sample data/);
  });
});

describe('AC8 / AC9: live scope, shared polling, and error preservation', () => {
  it('Super Admin and Executive see the campus; Office Head and Office Staff only their office', () => {
    assert.deepEqual(INSIGHTS_ROLES.length, 4);
    assert.equal(insightsScope({ role: ROLES.SUPER_ADMIN }).kind, 'campus');
    assert.equal(insightsScope({ role: ROLES.EXECUTIVE }).kind, 'campus');
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      assert.deepEqual(insightsScope({ role, officeId: 'o-1' }), { ok: true, kind: 'office', officeId: 'o-1' });
      assert.equal(insightsScope({ role }).ok, false, 'no office, nothing shown');
    }
  });

  it('uses live backend adapters and the shared polling hook with zero mock fallback', () => {
    assert.match(container, /useAnalytics\(\{/);
    assert.match(container, /insightsScope\(\{ role: user\.role, officeId: user\.officeId \}\)/);
    assert.match(container, /getInsightsOverview\(/);
    assert.match(container, /fetchOfficeModels\(/);
    assert.match(container, /data-testid="dashboard-period"/);
    assert.match(container, /data-testid="dashboard-office"/);
    assert.doesNotMatch(container, /setInterval|analytics-mock|isMockAnalytics|NEXT_PUBLIC_|ComplianceForecastChart/);
  });

  it('a failed refresh keeps the figures on screen and says so', () => {
    assert.match(container, /refreshError \?/);
    assert.match(container, /The latest refresh failed/);
    assert.match(container, /status === 'error'/);
  });
});
