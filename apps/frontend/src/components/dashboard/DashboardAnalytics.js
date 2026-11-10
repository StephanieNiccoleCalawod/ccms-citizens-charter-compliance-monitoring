'use client';

import { useMemo } from 'react';
import StatusBanner from '../feedback/StatusBanner.js';
import { insightsScope, updatedLabel } from '../../lib/ui/analytics.js';
import { useAnalytics } from '../../lib/ui/useAnalytics.js';
import AboutAnalyticsPanel from './AboutAnalyticsPanel.js';
import ComplianceForecastChart from './ComplianceForecastChart.js';
import ComplianceHeatmap from './ComplianceHeatmap.js';
import ComplianceKpiGrid from './ComplianceKpiGrid.js';
import ComplianceTrendChart from './ComplianceTrendChart.js';
import DashboardHeader from './DashboardHeader.js';
import KeyInsightsPanel from './KeyInsightsPanel.js';
import LateRiskPanel from './LateRiskPanel.js';
import RequestForecastSection from './RequestForecastSection.js';

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

/** Which offices a role may see is decided by insightsScope (and enforced by the services); the data source is the one flag in lib/api/analytics.js. */
export default function DashboardAnalytics({ user }) {
  const role = user.role;
  const officeId = user.officeId;
  const scope = useMemo(() => insightsScope({ role, officeId }), [role, officeId]);
  const { status, data, lastUpdated, refreshing, refreshError, error } = useAnalytics(scope);

  if (!scope.ok) return <StatusBanner variant="warning" message="Your account has no office assigned, so there are no analytics to show. Ask a Super Admin to assign your office." />;
  if (status === 'loading') return <Loading />;
  if (status === 'error') return <StatusBanner variant="error" message={error} />;

  const sample = data.source === 'mock';
  return (
    <div className="space-y-4">
      <DashboardHeader scope={data.scope} lastUpdated={lastUpdated} refreshing={refreshing} sample={sample} />
      {sample ? <StatusBanner variant="warning" message="Sample data: these figures are illustrative, not real measurements. The live analytics services (Sprint 6) are not connected." /> : null}
      {refreshError ? <StatusBanner variant="error" message={`The latest refresh failed, so these figures are from ${updatedLabel(lastUpdated).replace('Updated', 'the update at')}. ${refreshError}`} /> : null}

      <ComplianceKpiGrid kpis={data.pulse.kpis} />

      <div className={TWO_COLUMNS} data-testid="charts-row">
        <ComplianceTrendChart pulse={data.pulse} />
        <ComplianceForecastChart forecast={data.forecast} />
      </div>

      <div className={TWO_COLUMNS} data-testid="monitoring-row">
        <LateRiskPanel lateRisk={data.lateRisk} />
        <KeyInsightsPanel insights={data.insights} sample={sample} />
      </div>

      <ComplianceHeatmap heatmap={data.heatmap} scope={data.scope} />
      <RequestForecastSection user={user} />
      <AboutAnalyticsPanel sample={sample} />
    </div>
  );
}
