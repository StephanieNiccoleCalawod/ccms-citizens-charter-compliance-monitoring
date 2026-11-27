// The unified Office Head Dashboard: Dashboard and Office Home merged into one page for the Office Head only,
// with every other role (Super Admin, Executive, Office Staff) left exactly as it was.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { appNavForRole, landingForRole } from '../../src/lib/auth/permissions.js';
import { sortStaffRows, staffRows, tilesFor } from '../../src/lib/ui/kpi-home.js';

const path = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(path(p), 'utf8');

const page = read('src/app/page.js');
const officePage = read('src/app/office/page.js');
const dashboard = read('src/components/dashboard/office-head/OfficeHeadDashboard.js');
const kpiRow = read('src/components/dashboard/office-head/PersistentKpiRow.js');
const operations = read('src/components/dashboard/office-head/OperationsTab.js');
const staffTab = read('src/components/dashboard/office-head/StaffPerformanceTab.js');
const complianceTab = read('src/components/dashboard/office-head/ComplianceServiceTab.js');
const complaintsTab = read('src/components/dashboard/office-head/ComplaintsTab.js');

describe('navigation and landing change for the Office Head only', () => {
  it('Office Head lands on the Dashboard and has no separate Office Home item; Office Staff is unchanged', () => {
    assert.equal(landingForRole(ROLES.OFFICE_HEAD), '/');
    assert.equal(landingForRole(ROLES.OFFICE_STAFF), '/office');

    const headNav = appNavForRole(ROLES.OFFICE_HEAD);
    assert.equal(headNav.some((i) => i.href === '/office'), false, 'Office Head keeps no /office nav item');
    assert.ok(['/', '/services', '/calendar'].every((href) => headNav.some((i) => i.href === href)));

    const staffNav = appNavForRole(ROLES.OFFICE_STAFF);
    assert.ok(staffNav.some((i) => i.href === '/office' && i.label === 'Office Home'), 'Office Staff keeps Office Home');
  });
});

describe('app/page.js branches the signed-in Dashboard by role', () => {
  it('renders OfficeHeadDashboard for the Office Head and DashboardAnalytics for everyone else, unconditionally kept', () => {
    assert.match(page, /user\.role === ROLES\.OFFICE_HEAD \? <OfficeHeadDashboard user=\{user\} \/> : <DashboardAnalytics user=\{user\} \/>/);
  });
});

describe('app/office/page.js redirects the Office Head, keeps Office Staff on Office Home', () => {
  it('branches by role inside the render-prop; Office Staff still gets KpiHome', () => {
    assert.match(officePage, /allowedRoles=\{\[ROLES\.OFFICE_HEAD, ROLES\.OFFICE_STAFF\]\}/);
    assert.match(officePage, /user\.role === ROLES\.OFFICE_HEAD \? <RedirectToDashboard \/> : <KpiHome user=\{user\} \/>/);
    assert.match(officePage, /router\.replace\('\/'\)/);
  });
});

describe('the four persistent operational KPI cards', () => {
  it('are rendered above the Tabs (not inside a tab panel), from the same tilesFor() totals Office Home has always used', () => {
    const tabsIndex = dashboard.indexOf('<Tabs ');
    const kpiRowIndex = dashboard.indexOf('<PersistentKpiRow');
    assert.ok(kpiRowIndex > 0 && kpiRowIndex < tabsIndex, 'PersistentKpiRow is rendered before (outside) the Tabs');
    assert.match(kpiRow, /tilesFor\(totals\)/);
  });

  it('shows Received, Completed, Pending Now and Late, with Late in the danger tone and Pending Now labelled as current workload', () => {
    assert.match(kpiRow, /label="Received"/);
    assert.match(kpiRow, /label="Completed"/);
    assert.match(kpiRow, /label="Pending Now"[\s\S]{0,80}note="Current open workload"/);
    assert.match(kpiRow, /label="Late"[\s\S]{0,40}tone="danger"/);
  });

  it('Pending Now is the current open count, independent of the selected period (tilesFor\'s pending key)', () => {
    const tiles = tilesFor({ totals: { pending: { count: 7 }, received: 50 } });
    const pending = tiles.find((t) => t.key === 'pending');
    assert.equal(pending.value, 7);
  });
});

describe('the five dashboard tabs', () => {
  it('are Executive Overview, Operations, Staff Performance, Compliance and Service Performance, and Complaints', () => {
    for (const label of ['Executive Overview', 'Operations', 'Staff Performance', 'Compliance and Service Performance', 'Complaints']) {
      assert.ok(dashboard.includes(`label: '${label}'`), `missing tab: ${label}`);
    }
  });

  it('panels stay mounted and are hidden (not unmounted) when inactive, so the KPI row above them is unaffected by the active tab', () => {
    assert.match(dashboard, /hidden=\{activeTab !== 'overview'\}/);
    assert.match(dashboard, /hidden=\{activeTab !== 'operations'\}/);
    assert.match(dashboard, /hidden=\{activeTab !== 'staff'\}/);
    assert.match(dashboard, /hidden=\{activeTab !== 'compliance'\}/);
    assert.match(dashboard, /hidden=\{activeTab !== 'complaints'\}/);
  });

  it('does not render ComplianceKpiGrid (on-time/completed/open/high-risk), avoiding duplicate KPIs', () => {
    assert.equal(dashboard.includes('ComplianceKpiGrid'), false);
  });
});

describe('Operations tab: Needs Attention and Pending Transactions', () => {
  it('reuses the existing pending-transactions pagination (page/pageSize), not a client-only slice', () => {
    assert.match(operations, /pagination=\{\{/);
    assert.match(operations, /onPage: onPendingPageChange/);
  });

  it('offers All, Oldest First, Late/Overdue, High Risk and Approaching filters', () => {
    for (const label of ['Oldest First', 'Late / Overdue', 'High Risk', 'Approaching']) {
      assert.ok(operations.includes(label), `missing filter: ${label}`);
    }
  });

  it('Additional Metrics reuses more tilesFor() keys rather than a second calculation', () => {
    assert.match(operations, /tilesFor\(totals\)/);
    for (const key of ['average_time', 'median_time', 'early', 'auto_closed', 'cancelled', 'queue_wait']) {
      assert.ok(operations.includes(`'${key}'`), `missing additional metric: ${key}`);
    }
  });
});

describe('Staff Performance tab', () => {
  it('sorts by highest pending, most late, highest completed and lowest on-time rate', () => {
    for (const label of ['Highest Pending Workload', 'Most Late Transactions', 'Highest Completed Transactions', 'Lowest On-Time Rate']) {
      assert.ok(staffTab.includes(label), `missing sort option: ${label}`);
    }
  });

  it('sortStaffRows ranks by the requested column, like sortOfficeRows, and never invents a name', () => {
    const rows = staffRows(
      [
        { user_id: 'a', received: 10, results: { on_time: 4, late: 6, on_time_rate: 40 }, pending: { count: 1 } },
        { user_id: 'b', received: 5, results: { on_time: 5, late: 0, on_time_rate: 100 }, pending: { count: 9 } },
      ],
      new Map([['a', 'Alice']]),
    );
    assert.equal(rows.find((r) => r.id === 'a').name, 'Alice');
    assert.equal(rows.find((r) => r.id === 'b').name, 'Staff member');
    const byPending = sortStaffRows(rows, { key: 'pending', direction: 'desc' });
    assert.equal(byPending[0].id, 'b');
  });

  it('staffRows now also carries `completed`, additive and not replacing onTime/late/pending/cancelled', () => {
    const [row] = staffRows([{ user_id: 'a', received: 10, results: { on_time: 4, late: 6, on_time_rate: 40 }, pending: { count: 1 }, cancelled: 2 }]);
    assert.equal(row.completed, 10);
    assert.equal(row.onTime, 4);
    assert.equal(row.late, 6);
    assert.equal(row.pending, 1);
    assert.equal(row.cancelled, 2);
  });
});

describe('Compliance and Service Performance tab', () => {
  it('reuses the exact three Dashboard panels as sub-tabs, unchanged', () => {
    assert.match(complianceTab, /<ComplianceHeatmap heatmap=\{heatmapView\} scope=\{scope\} \/>/);
    assert.match(complianceTab, /<ServiceCharterPanel[\s\S]{0,400}showUnusual=\{false\}/);
    assert.match(complianceTab, /<UnusualCasesPanel overview=\{overview\} names=\{names\} scope=\{scope\} loading=\{loading\} error=\{error\} \/>/);
  });

  it('Client Satisfaction is preserved as a conditional sub-tab, counted by low ratings like the original Dashboard', () => {
    assert.match(complianceTab, /lowRatingRows\(ratings, scope\)\.length/);
  });
});

describe('Complaints tab', () => {
  it('shows the same four complaint KPI cards Office Home always had, plus a View Complaints link', () => {
    for (const label of ['Open Complaints', 'Overdue Response', 'Acknowledged', 'Resolved (Period)']) {
      assert.ok(complaintsTab.includes(`label="${label}"`), `missing: ${label}`);
    }
    assert.match(complaintsTab, /href="\/complaints"/);
  });
});

describe('CCMS design system alignment across Office Head Dashboard', () => {
  const needsAttention = read('src/components/dashboard/office-head/NeedsAttentionPanel.js');

  it('orders PersistentKpiRow above Period filter and Tabs, with AboutAnalyticsPanel at the bottom like DashboardAnalytics', () => {
    const kpiIdx = dashboard.indexOf('<PersistentKpiRow');
    const periodIdx = dashboard.indexOf('aria-label="Reporting period"');
    const tabsIdx = dashboard.indexOf('<Tabs');
    const aboutIdx = dashboard.indexOf('<AboutAnalyticsPanel');
    assert.ok(kpiIdx > 0 && periodIdx > kpiIdx && tabsIdx > periodIdx && aboutIdx > tabsIdx);
  });

  it('uses DM Sans + tabular-nums with zero font-mono across custom Office Head panels', () => {
    for (const [name, content] of [
      ['NeedsAttentionPanel.js', needsAttention],
      ['ComplianceServiceTab.js', complianceTab],
    ]) {
      assert.doesNotMatch(content, /\bfont-mono\b/, name);
      assert.match(content, /\btabular-nums\b/, name);
    }
  });
});
