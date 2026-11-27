'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dashboardComplianceHeatmap,
  dashboardKeyInsights,
  dashboardLateRisk,
  dashboardTrendPulse,
  fetchOfficeModels,
} from '../../../lib/api/analytics.js';
import { getInsightsOverview } from '../../../lib/api/insights.js';
import { getComplaintSummary, getKpis, getOfficePendingTransactions } from '../../../lib/api/kpis.js';
import { OFFICES_API, SERVICES_API } from '../../../lib/api/catalogue.js';
import { ACCOUNTS_API } from '../../../lib/api/identity.js';
import { fetchAllPages } from '../../../lib/api/client.js';
import { apiFetch } from '../../../lib/auth/session.js';
import { positionLabel } from '../../../lib/ui/account-position.js';
import { getRatingSummary } from '../../../lib/api/ratings.js';
import { insightsScope } from '../../../lib/ui/analytics.js';
import { hasSatisfaction } from '../../../lib/ui/case-flags.js';
import { failureMessage, staffRows } from '../../../lib/ui/kpi-home.js';
import { dashboardAuditCounts, PERIODS } from '../../../lib/ui/insights.js';
import { termPeriodText } from '../../../lib/ui/term-period.js';
import { useAnalytics } from '../../../lib/ui/useAnalytics.js';
import TermPeriodOptions, { useTerms } from '../../forms/TermPeriodOptions.js';
import StatusBanner from '../../feedback/StatusBanner.js';
import Tabs, { tabPanelProps } from '../../ui/Tabs.js';
import AboutAnalyticsPanel from '../AboutAnalyticsPanel.js';
import ComplianceTrendChart from '../ComplianceTrendChart.js';
import DashboardHeader from '../DashboardHeader.js';
import KeyInsightsPanel from '../KeyInsightsPanel.js';
import LateRiskPanel from '../LateRiskPanel.js';
import RequestForecastSection from '../RequestForecastSection.js';
import { TWO_COLUMNS } from '../DashboardAnalytics.js';
import ComplaintsTab from './ComplaintsTab.js';
import ComplianceServiceTab from './ComplianceServiceTab.js';
import OperationsTab from './OperationsTab.js';
import PersistentKpiRow from './PersistentKpiRow.js';
import StaffPerformanceTab from './StaffPerformanceTab.js';

// Which main tab (and, for Compliance, which sub-tab) a hash link such as DashboardHeader's "#charter" resolves to.
const ANCHOR_TO_TAB = Object.freeze({
  pulse: { tab: 'overview' },
  'request-forecast-heading': { tab: 'overview' },
  risk: { tab: 'overview' },
  'office-head-pending': { tab: 'operations' },
  heatmap: { tab: 'compliance', sub: 'heatmap' },
  'service-heatmap': { tab: 'compliance', sub: 'charter' },
  charter: { tab: 'compliance', sub: 'charter' },
  unusual: { tab: 'compliance', sub: 'unusual' },
});

function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your office dashboard">
      <div className="grid gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card h-24 animate-pulse bg-slate-100" />)}
      </div>
      <div className="card h-10 animate-pulse bg-slate-100" />
      <div className={TWO_COLUMNS}>
        <div className="card h-72 animate-pulse bg-slate-100" />
        <div className="card h-72 animate-pulse bg-slate-100" />
      </div>
      <p className="text-sm text-slate-500">Loading your office&rsquo;s dashboard…</p>
    </div>
  );
}

/**
 * The Office Head's one Dashboard: Dashboard (analytics, forecasting, charter performance) and Office Home
 * (operational KPIs, per-staff figures, pending transactions, complaints) merged into one page. The Office Head
 * is always office-scoped (never campus-wide), so this drops DashboardAnalytics.js's office-selector branching;
 * every figure still comes from the same lib/api calls and lib/ui calculations those two pages already used -
 * nothing here is a second, parallel calculation of the same number.
 */
export default function OfficeHeadDashboard({ user }) {
  const scope = useMemo(() => insightsScope({ role: user.role, officeId: user.officeId }), [user.role, user.officeId]);

  const [period, setPeriod] = useState('monthly');
  const termState = useTerms();
  const termText = termPeriodText(period, termState.terms);

  const [activeTab, setActiveTab] = useState('overview');
  const [complianceSubTab, setComplianceSubTab] = useState('charter');

  const [offices, setOffices] = useState([]);
  const [services, setServices] = useState([]);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);

  const [models, setModels] = useState({
    loading: true,
    lateRisk: { state: 'idle', value: null, message: '' },
    forecast: { state: 'idle', value: null, message: '' },
  });

  // Operational KPI totals and the per-staff breakdown (the two calls Office Home has always made).
  const [kpiState, setKpiState] = useState({ status: 'loading', answer: null, error: '' });
  const [totals, setTotals] = useState(null);
  const [accountNames, setAccountNames] = useState(new Map());
  const [accountPositions, setAccountPositions] = useState(new Map());

  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(20);
  const [pendingState, setPendingState] = useState({ loading: true, items: [], total: 0, error: '' });

  const [complaintsState, setComplaintsState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    if (!scope.ok) return undefined;
    let live = true;
    Promise.allSettled([fetchAllPages(OFFICES_API, apiFetch), fetchAllPages(SERVICES_API, apiFetch)]).then(([o, s]) => {
      if (!live) return;
      if (o.status === 'fulfilled') setOffices((o.value ?? []).filter((item) => item.is_active !== false));
      if (s.status === 'fulfilled') setServices((s.value ?? []).filter((item) => item.is_active !== false));
      setCatalogueLoaded(true);
    });
    return () => { live = false; };
  }, [scope.ok]);

  useEffect(() => {
    if (!scope.ok) return undefined;
    let live = true;
    fetchOfficeModels(user.officeId).then((result) => {
      if (live) setModels({ loading: false, lateRisk: result.lateRisk, forecast: result.forecast });
    });
    return () => { live = false; };
  }, [scope.ok, user.officeId]);

  const [{ status, data: overview, lastUpdated, refreshing, refreshError, error }] = useAnalytics({
    enabled: scope.ok,
    deps: [period, scope.officeId],
    load: () => getInsightsOverview({ period, officeId: '' }),
  });

  useEffect(() => {
    if (!scope.ok) return undefined;
    let active = true;
    Promise.resolve().then(() => { if (active) setKpiState((s) => ({ ...s, status: 'loading', error: '' })); });
    const common = { period, officeId: user.officeId };
    Promise.all([getKpis({ ...common, groupBy: 'staff' }), getKpis({ ...common, groupBy: 'total' })])
      .then(([grouped, total]) => { if (active) { setKpiState({ status: 'ready', answer: grouped, error: '' }); setTotals(total); } })
      .catch((failure) => { if (active) setKpiState((s) => ({ ...s, status: 'error', error: failureMessage(failure) })); });
    return () => { active = false; };
  }, [scope.ok, period, user.officeId]);

  useEffect(() => {
    if (!scope.ok) return undefined;
    let active = true;
    fetchAllPages(ACCOUNTS_API, apiFetch).then((items) => {
      if (!active) return;
      setAccountNames(new Map(items.map((a) => [a.account_id, a.full_name])));
      setAccountPositions(new Map(items.map((a) => [a.account_id, positionLabel(a.position)])));
    }).catch(() => {});
    return () => { active = false; };
  }, [scope.ok]);

  useEffect(() => {
    if (!scope.ok) return undefined;
    let active = true;
    Promise.resolve().then(() => { if (active) setPendingState((s) => ({ ...s, loading: true, error: '' })); });
    getOfficePendingTransactions({ page: pendingPage, pageSize: pendingPageSize })
      .then((data) => {
        if (!active) return;
        setPendingState({
          loading: false,
          items: Array.isArray(data?.items) ? data.items : [],
          total: Number.isFinite(Number(data?.total)) ? Number(data.total) : 0,
          error: '',
        });
      })
      .catch((failure) => { if (active) setPendingState((s) => ({ ...s, loading: false, items: [], error: failure?.message || 'Pending transactions could not be loaded.' })); });
    return () => { active = false; };
  }, [scope.ok, user.officeId, pendingPage, pendingPageSize]);

  useEffect(() => {
    if (!scope.ok) return undefined;
    let active = true;
    Promise.resolve().then(() => { if (active) setComplaintsState((s) => ({ ...s, loading: true, error: '' })); });
    getComplaintSummary({ officeId: user.officeId })
      .then((data) => { if (active) setComplaintsState({ loading: false, data, error: '' }); })
      .catch((failure) => { if (active) setComplaintsState({ loading: false, data: null, error: failure?.message || 'Complaints summary could not be loaded.' }); });
    return () => { active = false; };
  }, [scope.ok, user.officeId]);

  const catalogueNames = useMemo(() => ({
    offices: Object.fromEntries(offices.map((o) => [o.office_id, o.office_name])),
    services: Object.fromEntries(services.map((s) => [s.service_id, s.service_name])),
  }), [offices, services]);

  const trendPulse = useMemo(() => dashboardTrendPulse(overview), [overview]);
  const lateRiskView = useMemo(
    () => dashboardLateRisk({ lateRisk: models.lateRisk, officeName: catalogueNames.offices[user.officeId] ?? '' }),
    [models.lateRisk, catalogueNames, user.officeId],
  );
  const insightItems = useMemo(
    () => dashboardKeyInsights({ overview, forecast: models.forecast, lateRisk: models.lateRisk, names: catalogueNames, modelOffice: user.officeId }),
    [overview, models.forecast, models.lateRisk, catalogueNames, user.officeId],
  );
  const heatmapView = useMemo(() => dashboardComplianceHeatmap({ overview, scope, offices, names: catalogueNames }), [overview, scope, offices, catalogueNames]);
  const tabCounts = useMemo(() => dashboardAuditCounts({ overview, scope }), [overview, scope]);
  const staffRowsView = useMemo(() => staffRows(kpiState.answer?.groups, accountNames), [kpiState.answer, accountNames]);

  const [ratings, setRatings] = useState([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const ratingFrom = overview?.from;
  const ratingTo = overview?.to;
  useEffect(() => {
    if (!ratingFrom || !ratingTo) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setRatingsLoading(true); });
    getRatingSummary({ from: ratingFrom, to: ratingTo })
      .then((data) => !cancelled && setRatings(data?.items ?? []))
      .catch(() => !cancelled && setRatings([]))
      .finally(() => !cancelled && setRatingsLoading(false));
    return () => { cancelled = true; };
  }, [ratingFrom, ratingTo]);
  const showSatisfaction = hasSatisfaction(ratings);

  const navigateAnchor = useCallback((anchorId) => {
    const target = ANCHOR_TO_TAB[anchorId];
    if (!target) return;
    setActiveTab(target.tab);
    if (target.sub) setComplianceSubTab(target.sub);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.getElementById(anchorId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const id = window.location.hash.replace(/^#/, '');
      if (id) navigateAnchor(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigateAnchor]);

  if (!scope.ok) {
    return (
      <StatusBanner
        variant="warning"
        message="Your account has no office assigned, so there are no figures to show. Ask a Super Admin to assign your office."
      />
    );
  }
  if (status === 'loading' && !overview) return <Loading />;
  if (status === 'error' && !overview) return <StatusBanner variant="error" message={error} />;

  const label = termText ?? '';
  const openComplaints = complaintsState.data?.restricted ? 0 : (complaintsState.data?.open ?? 0);

  const complianceAlerts = tabCounts.flaggedCount + tabCounts.unusualCount;
  const tabs = [
    { id: 'overview', label: 'Executive Overview' },
    { id: 'operations', label: 'Operations', badge: pendingState.total > 0 ? String(pendingState.total) : null, badgeTone: 'neutral' },
    { id: 'staff', label: 'Staff Performance' },
    { id: 'compliance', label: 'Compliance and Service Performance', badge: complianceAlerts > 0 ? `${complianceAlerts} Alert${complianceAlerts === 1 ? '' : 's'}` : null, badgeTone: 'gold' },
    { id: 'complaints', label: 'Complaints', badge: openComplaints > 0 ? `${openComplaints} Open` : null, badgeTone: 'gold' },
  ];

  return (
    <div
      className="space-y-4"
      data-testid="office-head-dashboard"
      onClick={(e) => {
        const anchor = e.target?.closest?.('a[href^="#"]');
        const id = anchor?.getAttribute('href')?.slice(1);
        if (id && ANCHOR_TO_TAB[id]) {
          e.preventDefault();
          navigateAnchor(id);
        }
      }}
    >
      <DashboardHeader
        scope={scope}
        scopeLabel={catalogueNames.offices[user.officeId] || 'your office only'}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
      />

      {refreshError ? (
        <StatusBanner
          variant="error"
          message={`The latest refresh failed, so these figures are from ${lastUpdated ? 'the previous update' : 'earlier'}. ${refreshError}`}
        />
      ) : null}

      {kpiState.status === 'error' && kpiState.error ? (
        <StatusBanner variant="error" message={kpiState.error} />
      ) : null}

      <PersistentKpiRow
        totals={totals}
        loading={kpiState.status === 'loading'}
        periodLabel={label}
        onJumpToPending={() => navigateAnchor('office-head-pending')}
      />

      <div role="group" aria-label="Reporting period" className="flex flex-wrap items-end justify-end gap-4">
        <div className="w-full sm:w-48">
          <label htmlFor="office-head-period" className="label">Period</label>
          <select id="office-head-period" className="input select-chevron" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="office-head-period">
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <TermPeriodOptions terms={termState.terms} />
          </select>
          {label ? <p className="mt-1 text-xs text-ink-muted" data-testid="office-head-period-range">{label}</p> : null}
        </div>
      </div>

      <Tabs variant="analytics" label="Dashboard sections" idPrefix="office-head" tabs={tabs} value={activeTab} onChange={setActiveTab} supportingText="Scoped to your office" />

      <div {...tabPanelProps('office-head', 'overview')} hidden={activeTab !== 'overview'} className="space-y-4 focus:outline-none">
        <div className={TWO_COLUMNS} data-testid="office-head-charts-row">
          <ComplianceTrendChart pulse={trendPulse} />
          <div className="flex flex-col gap-4" data-testid="office-head-monitoring-stack">
            <LateRiskPanel lateRisk={lateRiskView} loading={models.loading} actionHref="/late-risk" />
            <KeyInsightsPanel insights={insightItems} />
          </div>
        </div>
        <RequestForecastSection
          user={user}
          controlledOfficeId={user.officeId}
          externalRun={models.forecast}
          preloadedOffices={offices}
          preloadedServices={services}
          scopeLabel={catalogueNames.offices[user.officeId] || ''}
          embedded
          onRunChange={(nextRun, runOfficeId) => {
            const effective = runOfficeId ?? nextRun?.officeId;
            if (nextRun && (!effective || effective === user.officeId)) {
              setModels((prev) => ({ ...prev, forecast: { state: 'ok', value: nextRun, message: '' } }));
            }
          }}
        />
      </div>

      <div {...tabPanelProps('office-head', 'operations')} hidden={activeTab !== 'operations'} className="space-y-4 focus:outline-none">
        <OperationsTab
          officeName={catalogueNames.offices[user.officeId] || 'your office'}
          pendingState={pendingState}
          pendingPage={pendingPage}
          pendingPageSize={pendingPageSize}
          onPendingPageChange={setPendingPage}
          onPendingPageSizeChange={(size) => { setPendingPageSize(size); setPendingPage(1); }}
          lateRiskState={models.lateRisk}
          totals={totals}
          loading={kpiState.status === 'loading'}
        />
      </div>

      <div {...tabPanelProps('office-head', 'staff')} hidden={activeTab !== 'staff'} className="space-y-4 focus:outline-none">
        <StaffPerformanceTab rows={staffRowsView} positions={accountPositions} loading={kpiState.status === 'loading'} />
      </div>

      <div {...tabPanelProps('office-head', 'compliance')} hidden={activeTab !== 'compliance'} className="space-y-4 focus:outline-none">
        <ComplianceServiceTab
          subTab={complianceSubTab}
          onSubTabChange={setComplianceSubTab}
          overview={overview}
          period={period}
          offices={offices}
          services={services}
          servicesLoaded={catalogueLoaded}
          names={catalogueNames}
          scope={scope}
          heatmapView={heatmapView}
          loading={status === 'loading' && !overview}
          error={status === 'error' && !overview ? error : null}
          flaggedCount={tabCounts.flaggedCount}
          unusualCount={tabCounts.unusualCount}
          ratings={ratings}
          ratingsLoading={ratingsLoading}
          showSatisfaction={showSatisfaction}
        />
      </div>

      <div {...tabPanelProps('office-head', 'complaints')} hidden={activeTab !== 'complaints'} className="space-y-4 focus:outline-none">
        <ComplaintsTab complaintsState={complaintsState} />
      </div>

      <AboutAnalyticsPanel
        completedRows={overview?.about?.completed_rows}
        lateCases={overview?.about?.late_cases}
      />
    </div>
  );
}
