import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

describe('shared EmptyState, TableState, DataTable, and ChartCard', () => {
  const empty = read('src/components/ui/EmptyState.js');
  const tableState = read('src/components/ui/TableState.js');
  const dataTable = read('src/components/ui/DataTable.js');
  const chartCard = read('src/components/charts/ChartCard.js');

  it('EmptyState supports semantic variants, named icons, title, description, supportingInfo, actions, size, and surface in DM Sans without font-mono', () => {
    for (const prop of [
      "variant = 'neutral'",
      'icon,',
      'title,',
      'description,',
      'supportingInfo = null',
      'actionLabel = null',
      'onAction = null',
      'actionHref = null',
      "size = 'default'",
      "surface = 'subtle'",
    ]) {
      assert.ok(empty.includes(prop), `missing EmptyState prop: ${prop}`);
    }
    assert.doesNotMatch(empty, /\bfont-mono\b/);
    assert.match(empty, /font-sans/);
    assert.match(empty, /border-emerald-200 bg-emerald-50 text-emerald-600/);
  });

  it('TableState uses EmptyState for empty rows while keeping loading and error states separate', () => {
    assert.match(tableState, /import EmptyState from '\.\/EmptyState\.js';/);
    const loadingBlock = tableState.slice(tableState.indexOf("kind === 'loading'"), tableState.indexOf("kind === 'error'"));
    const errorBlock = tableState.slice(tableState.indexOf("kind === 'error'"), tableState.indexOf('<EmptyState'));
    assert.doesNotMatch(loadingBlock, /<EmptyState/);
    assert.doesNotMatch(errorBlock, /<EmptyState/);
    assert.match(tableState, /<EmptyState[\s\S]*surface="plain"[\s\S]*size="compact"/);
  });

  it('DataTable and ChartCard forward structured empty-state props', () => {
    assert.match(dataTable, /emptyTitle = null/);
    assert.match(dataTable, /emptyActionLabel = null/);
    assert.match(dataTable, /<TableState[\s\S]*title=\{emptyTitle\}/);
    assert.match(chartCard, /emptyTitle = null/);
    assert.match(chartCard, /<EmptyState[\s\S]*title=\{emptyTitle\}/);
  });
});

describe('system-wide empty state consistency across CCMS modules', () => {
  it('UnusualCasesPanel reuses EmptyState directly and shows the success badge only when data is analyzed with none detected', () => {
    const unusual = read('src/components/dashboard/UnusualCasesPanel.js');
    assert.match(unusual, /import EmptyState from '\.\.\/ui\/EmptyState\.js';/);
    assert.match(unusual, /const isSuccess = reason === 'none_detected';/);
    assert.match(unusual, /variant=\{isSuccess \? 'success' : 'neutral'\}/);
    assert.match(unusual, /icon=\{isSuccess \? 'check' : 'chart'\}/);
    assert.doesNotMatch(unusual, /\bfont-mono\b/);
  });

  it('all major CCMS modules use structured EmptyState / TableState / DataTable empty states with contextual titles', () => {
    const checks = [
      ['src/components/dashboard/ComplianceKpiGrid.js', /title="No Indicators Available"/],
      ['src/components/dashboard/ComplianceTrendChart.js', /emptyTitle="No Compliance History Yet"/],
      ['src/components/dashboard/LateRiskPanel.js', /emptyTitle="No Open Transactions"/],
      ['src/components/dashboard/KeyInsightsPanel.js', /title="No Operational Warnings"/],
      ['src/components/dashboard/ComplianceHeatmap.js', /emptyTitle="No Office Performance Data Yet"/],
      ['src/components/dashboard/ServiceLateRateMatrix.js', /No Flagged Services Found/],
      ['src/components/dashboard/ServiceCharterPanel.js', /emptyTitle=/],
      ['src/components/dashboard/ClientSatisfactionPanel.js', /emptyTitle="No Ratings for This Period"/],
      ['src/components/dashboard/RequestForecastSection.js', /<EmptyState[\s\S]*title="No Forecast Available Yet"/],
      ['src/components/analytics/LateRiskSection.js', /No Open Transactions[\s\S]*No Matching Open Transactions|No Matching Open Transactions[\s\S]*No Open Transactions/],
      ['src/components/home/KpiHome.js', /emptyTitle="No Open Transactions"/],
      ['src/components/dashboard/office-head/OperationsTab.js', /No Open Transactions[\s\S]*No Matching Transactions Found/],
      ['src/components/dashboard/office-head/StaffPerformanceTab.js', /title="No Staff Records for This Period"/],
      ['src/components/dashboard/office-head/ComplianceServiceTab.js', /emptyTitle="No Records for This Period"/],
      ['src/components/dashboard/office-head/ComplaintsTab.js', /emptyTitle="No Complaints Yet"/],
      ['src/app/transactions/page.js', /No Matching Transactions Found[\s\S]*No Transactions Yet/],
      ['src/components/queue/QueuePanel.js', /<EmptyState[\s\S]*title="No Ticket Currently Called"[\s\S]*<EmptyState[\s\S]*title="No Visitors Waiting"/],
      ['src/components/reports/ReportsPage.js', /No Matching Reports Found/],
      ['src/components/ratings/RatingsSection.js', /<EmptyState[\s\S]*title="No Ratings for This Period"/],
      ['src/components/complaints/ComplaintsPage.js', /No Matching Complaints Found/],
      ['src/app/services/page.js', /No Matching Services Found[\s\S]*No Services Available/],
      ['src/app/offices/page.js', /No Offices Yet[\s\S]*No Matching Offices Found/],
      ['src/app/accounts/page.js', /No Matching Accounts Found[\s\S]*No Accounts Yet/],
      ['src/components/public/PublicDirectory.js', /<EmptyState[\s\S]*title="No Services Published Yet"/],
      ['src/app/calendar/Terms.js', /<TableState colSpan=\{3\} icon="calendar" title="No Academic Terms Yet">/],
      ['src/app/calendar/Holidays.js', /<EmptyState[\s\S]*title="No Holidays in Registry"/],
      ['src/app/calendar/WorkingHoursScope.js', /<EmptyState surface="plain" size="compact" icon="clock" title="No Custom Schedule Records">/],
      ['src/components/notifications/NotificationCenter.js', /No Matching Notifications[\s\S]*No Notifications Yet/],
      ['src/components/notifications/NotificationPanel.js', /<EmptyState[\s\S]*No Unread Notifications/],
      ['src/app/settings/connected-systems/SyncPanel.js', /<TableState colSpan=\{5\} icon="sync" title="No Sync Activity Yet">/],
      ['src/app/settings/Counters.js', /title="No Counters Yet"/],
      ['src/components/account/RolesMatrix.js', /title="No Matching Capabilities"/],
      ['src/components/access/AccessPage.js', /emptyTitle="No Pending Access Requests"/],
      ['src/components/account/ClerkAccessPanel.js', /emptyTitle=/],
      ['src/app/settings/security/page.js', /title="No Session Policies Available"/],
      ['src/app/logs/page.js', /No Matching Audit Entries[\s\S]*No Audit Entries Yet/],
      ['src/app/registry/RegistryOverview.js', /title="No Registry Records Yet"[\s\S]*title="No Matching Academic Programs"/],
      ['src/app/registry/ImportHistory.js', /emptyTitle="No Imports Yet"/],
    ];
    for (const [file, pattern] of checks) {
      assert.match(read(file), pattern, file);
    }
  });
});
