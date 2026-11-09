// Dashboard redesign: the analytics sit inside the Dashboard (the signed-in home page), in the agreed order and grid. Source checks,
// not a browser: the real layout was also looked at in a browser (see the report).
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

describe('AC1 / AC2: analytics are in the Dashboard and the Insights menu entry is gone', () => {
  it('the signed-in home page renders the analytics first, then the service finder it always had', () => {
    assert.match(page, /<AppShell title="Dashboard"/);
    assert.ok(page.indexOf('<DashboardAnalytics user={user} />') > 0);
    assert.ok(page.indexOf('<DashboardAnalytics') < page.indexOf('role="search"'), 'analytics come before the service finder');
    assert.ok(page.indexOf('role="search"') < page.indexOf('<ServiceResults catalogue={catalogue} />'));
  });

  it('keeps the existing Dashboard: search, filters, grid/list view, pager and the public landing page', () => {
    for (const text of ['useCatalogue()', 'id="home-search"', 'ViewToggle', 'ClassificationPills', 'OfficeSelect', '<Pager', 'data-testid="service-grid"', 'data-testid="service-list"', '<LandingHero />', "mode === 'public'"]) {
      assert.ok(page.includes(text), `the page lost: ${text}`);
    }
  });

  it('no role has an Insights sidebar entry, no entry is duplicated, and every other item is still there', () => {
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.ok(!nav.some((i) => /insights/i.test(i.label)), role);
      assert.equal(new Set(nav.map((i) => i.href)).size, nav.length, `${role}: duplicated entries`);
      assert.ok(['/', '/services', '/calendar'].every((href) => nav.some((i) => i.href === href)), role);
    }
    const labels = (role) => appNavForRole(role).map((i) => i.label);
    assert.ok(['Accounts', 'Offices', 'Registry', 'Logs', 'Transactions'].every((l) => labels(ROLES.SUPER_ADMIN).includes(l)));
    assert.ok(labels(ROLES.OFFICE_STAFF).includes('Transactions'));
  });
});

describe('the sections, in order', () => {
  const order = ['<DashboardHeader', '<ComplianceKpiGrid', '<ComplianceTrendChart', '<ComplianceForecastChart', '<LateRiskPanel', '<KeyInsightsPanel', '<ComplianceHeatmap', '<AboutAnalyticsPanel'];

  it('header, KPI cards, trend and forecast, late risk and key insights, heatmap, about', () => {
    const positions = order.map((tag) => container.indexOf(tag));
    assert.ok(positions.every((p) => p > 0), 'every section is used');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'in the agreed order');
  });

  it('every section is its own component file', () => {
    for (const name of ['DashboardHeader', 'ComplianceKpiGrid', 'ComplianceTrendChart', 'ComplianceForecastChart', 'LateRiskPanel', 'KeyInsightsPanel', 'ComplianceHeatmap', 'AboutAnalyticsPanel', 'DashboardAnalytics']) {
      assert.ok(existsSync(path(`src/components/dashboard/${name}.js`)), name);
    }
  });
});

describe('AC3 to AC7 / AC10: the two-column layout and the responsive rules', () => {
  it('trend and forecast share one two-column row; late risk and key insights share another', () => {
    assert.match(container, /export const TWO_COLUMNS = 'grid items-stretch gap-4 lg:grid-cols-2'/);
    const rows = [...container.matchAll(/<div className=\{TWO_COLUMNS\} data-testid="(charts-row|monitoring-row)">([\s\S]*?)<\/div>/g)];
    assert.deepEqual(rows.map((m) => m[1]), ['charts-row', 'monitoring-row']);
    assert.match(rows[0][2], /<ComplianceTrendChart[\s\S]*<ComplianceForecastChart/);
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

  it('cards in a row stretch to one height, and a chart card pins its table link to the bottom', () => {
    assert.match(container, /items-stretch/);
    const frame = read('src/components/charts/ChartCard.js');
    assert.match(frame, /flex h-full flex-col/);
    assert.match(frame, /mt-auto/);
    assert.match(read('src/components/dashboard/KeyInsightsPanel.js'), /flex h-full flex-col/);
  });

  it('nothing forces two columns on a phone, and wide content scrolls inside its own frame', () => {
    const all = ['DashboardAnalytics', 'ComplianceKpiGrid', 'LateRiskPanel', 'KeyInsightsPanel'].map((n) => read(`src/components/dashboard/${n}.js`)).join('\n');
    assert.doesNotMatch(all, /(?<![:\w-])grid-cols-[2-9]/);
    assert.match(read('src/components/ui/TableShell.js'), /overflow-x-auto/);
    assert.match(read('src/components/charts/Heatmap.js'), /<Table\s/);
  });
});

describe('the About panel and the header', () => {
  it('About is a collapsed disclosure that covers compliance, forecast, late risk, heatmap and data limitations', () => {
    const about = read('src/components/dashboard/AboutAnalyticsPanel.js');
    assert.match(about, /<details className=/);
    assert.doesNotMatch(about, /<details[^>]*\sopen/);
    for (const word of ['Compliance:', 'Forecast:', 'Late risk:', 'Heatmap:', 'Data limitations:', 'Sprint 6']) assert.ok(about.includes(word), word);
  });

  it('the header shows the scope, the last update in TT10 time and the refresh indicator', () => {
    const header = read('src/components/dashboard/DashboardHeader.js');
    assert.match(header, /whole campus/);
    assert.match(header, /your office only/);
    assert.match(header, /updatedLabel\(lastUpdated\)/);
    assert.match(header, /Refreshing…/);
    assert.match(header, /Refreshes every minute/);
  });
});

describe('AC8 / AC9: data scope and refresh are the existing ones', () => {
  it('Super Admin and Executive see the campus; Office Head and Office Staff only their office', () => {
    assert.deepEqual(INSIGHTS_ROLES.length, 4);
    assert.equal(insightsScope({ role: ROLES.SUPER_ADMIN }).kind, 'campus');
    assert.equal(insightsScope({ role: ROLES.EXECUTIVE }).kind, 'campus');
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      assert.deepEqual(insightsScope({ role, officeId: 'o-1' }), { ok: true, kind: 'office', officeId: 'o-1' });
      assert.equal(insightsScope({ role }).ok, false, 'no office, nothing shown');
    }
  });

  it('the container uses the one polling hook, the one scope function and the one flag-driven loader, and nothing else', () => {
    assert.match(container, /useAnalytics\(scope\)/);
    assert.match(container, /insightsScope\(\{ role, officeId \}\)/);
    assert.doesNotMatch(container, /setInterval|fetch\(|apiFetch|analytics-mock|NEXT_PUBLIC_/);
    assert.match(read('src/lib/ui/useAnalytics.js'), /loadAnalytics/);
  });

  it('a failed refresh keeps the figures on screen and says so', () => {
    assert.match(container, /refreshError \?/);
    assert.match(container, /The latest refresh failed/);
    assert.match(container, /status === 'error'/);
  });
});
