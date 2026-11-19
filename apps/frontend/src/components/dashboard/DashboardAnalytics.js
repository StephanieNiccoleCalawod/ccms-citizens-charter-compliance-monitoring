'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dashboardComplianceHeatmap,
  dashboardKeyInsights,
  dashboardKpis,
  dashboardLateRisk,
  dashboardTrendPulse,
  fetchOfficeModels,
} from '../../lib/api/analytics.js';
import { OFFICES_API, SERVICES_API } from '../../lib/api/catalogue.js';
import { fetchAllPages } from '../../lib/api/client.js';
import { getInsightsOverview } from '../../lib/api/insights.js';
import { apiFetch } from '../../lib/auth/session.js';
import { canViewInsights, insightsScope } from '../../lib/ui/analytics.js';
import { PERIODS, buildDashboardTabs, dashboardAuditCounts } from '../../lib/ui/insights.js';
import { useAnalytics } from '../../lib/ui/useAnalytics.js';
import StatusBanner from '../feedback/StatusBanner.js';
import FilterBar from '../forms/FilterBar.js';
import Tabs, { tabPanelProps } from '../ui/Tabs.js';
import AboutAnalyticsPanel from './AboutAnalyticsPanel.js';
import ComplianceHeatmap from './ComplianceHeatmap.js';
import ComplianceKpiGrid from './ComplianceKpiGrid.js';
import ComplianceTrendChart from './ComplianceTrendChart.js';
import DashboardHeader from './DashboardHeader.js';
import KeyInsightsPanel from './KeyInsightsPanel.js';
import LateRiskPanel from './LateRiskPanel.js';
import RequestForecastSection from './RequestForecastSection.js';
import ServiceCharterPanel from './ServiceCharterPanel.js';
import UnusualCasesPanel from './UnusualCasesPanel.js';

const ANCHOR_TO_TAB = Object.freeze({
  pulse: 'overview',
  'request-forecast-heading': 'overview',
  risk: 'overview',
  heatmap: 'heatmap',
  'service-heatmap': 'charter',
  charter: 'charter',
  unusual: 'unusual',
});

// The analytics half of the Dashboard. Every section sits in a grid: one column on a phone, two equal columns from the lg size
// (a tablet's sidebar is usually collapsed, so two columns fit there too). Cards in a row stretch to the same height.
export const TWO_COLUMNS = 'grid items-stretch gap-4 lg:grid-cols-2';

function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading analytics">
      <div className="grid gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card h-24 animate-pulse bg-slate-100" />)}
      </div>
      <div className={TWO_COLUMNS}>
        <div className="card h-72 animate-pulse bg-slate-100" />
        <div className="card h-72 animate-pulse bg-slate-100" />
      </div>
      <p className="text-sm text-slate-500">Loading analytics…</p>
    </div>
  );
}

/**
 * Main Dashboard analytics overview (live backend APIs only).
 * Order: FilterBar + DashboardHeader -> 4 KPI Summary Cards -> Compliance Trend + Request Volume Forecast ->
 * Late-Risk Monitoring + Key Insights -> Compliance Heatmap -> About analytics.
 */
export default function DashboardAnalytics({ user }) {
  if (!user || !canViewInsights(user.role)) return null;
  return <LiveDashboardAnalytics user={user} />;
}

function LiveDashboardAnalytics({ user }) {
  const scope = useMemo(() => insightsScope({ role: user.role, officeId: user.officeId }), [user.role, user.officeId]);
  const isCampusRole = scope.kind === 'campus';

  const [period, setPeriod] = useState('monthly');
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [offices, setOffices] = useState([]);
  const [services, setServices] = useState([]);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);
  const [models, setModels] = useState({
    officeId: '',
    loading: false,
    lateRisk: { state: 'idle', value: null, message: '' },
    forecast: { state: 'idle', value: null, message: '' },
  });

  const modelReqSeqRef = useRef(0);
  const loadedModelOfficeRef = useRef('');
  const defaultCampusOffice = isCampusRole && !selectedOfficeId ? (offices[0]?.office_id ?? '') : '';
  const modelOffice = scope.kind === 'office'
    ? (scope.officeId ?? '')
    : (selectedOfficeId || defaultCampusOffice);
  const modelOfficeRef = useRef(modelOffice);
  useEffect(() => {
    modelOfficeRef.current = modelOffice;
  }, [modelOffice]);

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

  const loadModels = useCallback(async (targetOffice, { background = false } = {}) => {
    const seq = ++modelReqSeqRef.current;
    if (!targetOffice) {
      loadedModelOfficeRef.current = '';
      setModels({
        officeId: '',
        loading: false,
        lateRisk: { state: 'pick', value: null, message: '' },
        forecast: { state: 'pick', value: null, message: '' },
      });
      return;
    }
    loadedModelOfficeRef.current = targetOffice;
    if (!background) {
      setModels((prev) => ({
        officeId: targetOffice,
        loading: true,
        lateRisk: prev.officeId === targetOffice && prev.lateRisk.state === 'ok'
          ? prev.lateRisk
          : { state: 'loading', value: null, message: '' },
        forecast: prev.officeId === targetOffice && prev.forecast.state === 'ok'
          ? prev.forecast
          : { state: 'loading', value: null, message: '' },
      }));
    }
    const result = await fetchOfficeModels(targetOffice);
    if (seq !== modelReqSeqRef.current) return;
    setModels({
      officeId: targetOffice,
      loading: false,
      lateRisk: result.lateRisk,
      forecast: result.forecast,
    });
  }, []);

  const [{ status, data: overview, lastUpdated, refreshing, refreshError, error }] = useAnalytics({
    enabled: scope.ok,
    deps: [period, selectedOfficeId, scope.kind, scope.officeId],
    load: async () => {
      const requestedOffice = isCampusRole ? selectedOfficeId : '';
      const activeTarget = isCampusRole ? (selectedOfficeId || modelOfficeRef.current) : (scope.officeId ?? '');
      const background = Boolean(activeTarget) && loadedModelOfficeRef.current === activeTarget;
      const [nextOverview] = await Promise.all([
        getInsightsOverview({ period, officeId: requestedOffice }),
        activeTarget ? loadModels(activeTarget, { background }) : Promise.resolve(),
      ]);
      return nextOverview;
    },
  });

  // When a campus user lands with "Whole campus" selected, fetch models once the first active office arrives.
  useEffect(() => {
    if (!scope.ok || !isCampusRole || selectedOfficeId || !defaultCampusOffice) return;
    if (loadedModelOfficeRef.current === defaultCampusOffice) return;
    Promise.resolve().then(() => loadModels(defaultCampusOffice, { background: false }));
  }, [scope.ok, isCampusRole, selectedOfficeId, defaultCampusOffice, loadModels]);

  const names = useMemo(() => ({
    offices: Object.fromEntries(offices.map((o) => [o.office_id, o.office_name])),
    services: Object.fromEntries(services.map((s) => [s.service_id, s.service_name])),
  }), [offices, services]);

  const activeModelOfficeName = names.offices[modelOffice] ?? '';
  const effectiveScope = useMemo(() => (
    scope.kind === 'office'
      ? scope
      : selectedOfficeId
        ? { ok: true, kind: 'office', officeId: selectedOfficeId }
        : { ok: true, kind: 'campus', officeId: null }
  ), [scope, selectedOfficeId]);

  const kpis = useMemo(
    () => dashboardKpis({ overview, lateRisk: models.lateRisk }),
    [overview, models.lateRisk],
  );
  const trendPulse = useMemo(() => dashboardTrendPulse(overview), [overview]);
  const lateRiskView = useMemo(
    () => dashboardLateRisk({
      lateRisk: models.lateRisk,
      officeName: isCampusRole && !selectedOfficeId && activeModelOfficeName
        ? `Showing ${activeModelOfficeName} (choose an office above to change)`
        : activeModelOfficeName,
    }),
    [models.lateRisk, isCampusRole, selectedOfficeId, activeModelOfficeName],
  );
  const insightItems = useMemo(
    () => dashboardKeyInsights({
      overview,
      forecast: models.forecast,
      lateRisk: models.lateRisk,
      names,
      modelOffice,
    }),
    [overview, models.forecast, models.lateRisk, names, modelOffice],
  );
  const heatmapView = useMemo(
    () => dashboardComplianceHeatmap({ overview, scope: effectiveScope, offices, names }),
    [overview, effectiveScope, offices, names],
  );
  const tabCounts = useMemo(
    () => dashboardAuditCounts({ overview, scope: effectiveScope }),
    [overview, effectiveScope],
  );
  const dashboardTabs = useMemo(() => buildDashboardTabs(tabCounts), [tabCounts]);

  const navigateAnchor = useCallback((anchorId) => {
    const targetTab = ANCHOR_TO_TAB[anchorId];
    if (!targetTab) return;
    setActiveTab(targetTab);
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
        message="Your account has no office assigned, so there are no analytics to show. Ask a Super Admin to assign your office."
      />
    );
  }
  if (status === 'loading' && !overview) return <Loading />;
  if (status === 'error' && !overview) return <StatusBanner variant="error" message={error} />;

  const forecastScopeNote = isCampusRole && !selectedOfficeId && activeModelOfficeName
    ? `Showing ${activeModelOfficeName} (choose an office above to switch)`
    : activeModelOfficeName;

  return (
    <div
      className="space-y-4"
      data-testid="dashboard-analytics"
      onClick={(e) => {
        const anchor = e.target?.closest?.('a[href^="#"]');
        const id = anchor?.getAttribute('href')?.slice(1);
        if (id && ANCHOR_TO_TAB[id]) navigateAnchor(id);
      }}
    >
      <FilterBar label="Dashboard analytics filters">
        <div className="w-full sm:w-48">
          <label htmlFor="dashboard-period" className="label">Period</label>
          <select
            id="dashboard-period"
            className="input select-chevron"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            data-testid="dashboard-period"
          >
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {isCampusRole ? (
          <div className="w-full sm:w-72">
            <label htmlFor="dashboard-office" className="label">Office</label>
            <select
              id="dashboard-office"
              className="input select-chevron"
              value={selectedOfficeId}
              onChange={(e) => setSelectedOfficeId(e.target.value)}
              data-testid="dashboard-office"
            >
              <option value="">Whole campus</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select>
          </div>
        ) : null}
      </FilterBar>

      <DashboardHeader
        scope={effectiveScope}
        scopeLabel={effectiveScope.kind === 'office' ? (names.offices[effectiveScope.officeId] || 'your office only') : 'the whole campus'}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
      />

      {refreshError ? (
        <StatusBanner
          variant="error"
          message={`The latest refresh failed, so these figures are from ${lastUpdated ? 'the previous update' : 'earlier'}. ${refreshError}`}
        />
      ) : null}

      <ComplianceKpiGrid kpis={kpis} />

      <Tabs
        variant="analytics"
        label="Dashboard analytics sections"
        idPrefix="dashboard"
        tabs={dashboardTabs}
        value={activeTab}
        onChange={setActiveTab}
        supportingText="Charter check & cell drilldown enabled"
      />

      <div {...tabPanelProps('dashboard', 'overview')} hidden={activeTab !== 'overview'} className="space-y-4 focus:outline-none">
        <div className={TWO_COLUMNS} data-testid="charts-row">
          <ComplianceTrendChart pulse={trendPulse} />
          <RequestForecastSection
            user={user}
            controlledOfficeId={modelOffice}
            externalRun={models.forecast}
            preloadedOffices={offices}
            preloadedServices={services}
            scopeLabel={forecastScopeNote}
            embedded
            onRunChange={(nextRun, runOfficeId) => {
              const effective = runOfficeId ?? nextRun?.officeId;
              if (nextRun && (!effective || modelOfficeRef.current === effective)) {
                setModels((prev) => ({
                  ...prev,
                  forecast: { state: 'ok', value: nextRun, message: '' },
                }));
              }
            }}
          />
        </div>

        <div className={TWO_COLUMNS} data-testid="monitoring-row">
          <LateRiskPanel lateRisk={lateRiskView} loading={models.loading} actionHref="/late-risk" />
          <KeyInsightsPanel insights={insightItems} />
        </div>
      </div>

      <div {...tabPanelProps('dashboard', 'heatmap')} hidden={activeTab !== 'heatmap'} className="space-y-4 focus:outline-none">
        <ComplianceHeatmap heatmap={heatmapView} scope={effectiveScope} />
      </div>

      <div {...tabPanelProps('dashboard', 'charter')} hidden={activeTab !== 'charter'} className="space-y-4 focus:outline-none">
        <ServiceCharterPanel
          key={`${period}:${selectedOfficeId}`}
          overview={overview}
          period={period}
          offices={offices}
          services={services}
          servicesLoaded={catalogueLoaded}
          names={names}
          scope={effectiveScope}
          loading={status === 'loading' && !overview}
          error={status === 'error' && !overview ? error : null}
          showUnusual={false}
        />
      </div>

      <div {...tabPanelProps('dashboard', 'unusual')} hidden={activeTab !== 'unusual'} className="space-y-4 focus:outline-none">
        <UnusualCasesPanel
          overview={overview}
          names={names}
          scope={effectiveScope}
          loading={status === 'loading' && !overview}
          error={status === 'error' && !overview ? error : null}
        />
      </div>

      <AboutAnalyticsPanel
        completedRows={overview?.about?.completed_rows}
        lateCases={overview?.about?.late_cases}
      />
    </div>
  );
}
