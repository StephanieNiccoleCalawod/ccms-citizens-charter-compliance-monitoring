'use client';

import { useMemo, useState } from 'react';
import { lowRatingRows, withSatisfactionTab } from '../../../lib/ui/case-flags.js';
import { durationComparisonStatus, isCharterFlagged, isCharterLowSample, minutesText } from '../../../lib/ui/insights.js';
import { tabPanelProps } from '../../ui/Tabs.js';
import DataTable from '../../ui/DataTable.js';
import StatusBadge from '../../ui/StatusBadge.js';
import CaseFlagsPanel from '../CaseFlagsPanel.js';
import ClientSatisfactionPanel from '../ClientSatisfactionPanel.js';
import ComplianceHeatmap from '../ComplianceHeatmap.js';
import ServiceCharterPanel from '../ServiceCharterPanel.js';
import UnusualCasesPanel from '../UnusualCasesPanel.js';

const BASE_TABS = [{ id: 'charter', label: 'Service Charter Compliance' }, { id: 'heatmap', label: 'Office Performance Overview' }];

/** The status pill for one service row, using the same thresholds ServiceCharterPanel's own finding badge uses. */
function finding(row, minReliable) {
  if (isCharterLowSample(row, minReliable)) return <StatusBadge variant="neutral" className="border border-slate-200">Too Few to Judge</StatusBadge>;
  if (Number(row.late_rate) > 20) return <StatusBadge variant="danger" className="border border-red-200">Below 90% Floor</StatusBadge>;
  if (isCharterFlagged(row, minReliable)) return <StatusBadge variant="warning" className="border border-[#E5B53A]">Unusual Delay Flag</StatusBadge>;
  return <StatusBadge variant="success" className="border border-emerald-200">Compliant</StatusBadge>;
}

/** Segmented sub-navigation inside the Compliance tab, using CCMS's elevated surface control aesthetic. */
function PillTabs({ tabs, value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Compliance and service performance sections"
      className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-muted p-1"
    >
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            data-testid={`ohd-compliance-tab-${t.id}`}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon ${
              selected ? 'bg-surface text-pup-maroon shadow-2xs ring-1 ring-line/80' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== null ? (
              <span className="inline-flex items-center rounded-full border border-tag-border bg-tag-bg px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums text-[#800000]">
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tab 4: the exact three Dashboard sections the task names (Office Performance Overview, Service Charter
 * Compliance, Unusual Delays) as sub-tabs of one tab, instead of three top-level ones. Same components, same
 * props, same data DashboardAnalytics.js has always used - only the grouping (and, for Service Charter
 * Compliance, an added "Inspect Service" summary) changed. Client Satisfaction stays too (it was already paired
 * with these on the Dashboard), shown only when there is something to show.
 */
export default function ComplianceServiceTab({
  subTab,
  onSubTabChange,
  overview,
  period,
  offices,
  services,
  servicesLoaded,
  names,
  scope,
  heatmapView,
  loading,
  error,
  flaggedCount,
  unusualCount,
  ratings,
  ratingsLoading,
  showSatisfaction,
}) {
  const tabs = withSatisfactionTab(
    [
      { ...BASE_TABS[0], badge: flaggedCount > 0 ? `${flaggedCount} flagged` : null },
      BASE_TABS[1],
      { id: 'unusual', label: 'Unusual Delays', badge: unusualCount > 0 ? unusualCount : null },
    ],
    showSatisfaction,
    lowRatingRows(ratings, scope).length,
  );

  const minReliable = Number(overview?.min_cell_completed) || 5;
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;
  const scopedServices = useMemo(() => {
    const raw = overview?.charter?.services ?? [];
    return scopedOffice ? raw.filter((r) => String(r.office_id ?? '').toLowerCase() === scopedOffice) : raw;
  }, [overview, scopedOffice]);

  const [selectedKey, setSelectedKey] = useState('');
  const selected = scopedServices.find((r) => `${r.office_id}:${r.service_id}` === selectedKey) ?? scopedServices[0] ?? null;
  const selectedName = selected ? (names.services?.[selected.service_id] ?? selected.service_code ?? 'Service') : '';
  const flagged = selected ? isCharterFlagged(selected, minReliable) : false;
  const cmp = selected ? durationComparisonStatus(selected) : null;
  const complianceRate = selected && Number.isFinite(Number(selected.late_rate)) ? Math.round((100 - Number(selected.late_rate)) * 10) / 10 : null;
  const varianceDays = selected && selected.p90_minutes != null && selected.limit_minutes
    ? Math.round(((Number(selected.p90_minutes) - Number(selected.limit_minutes)) / 480) * 10) / 10 // 480 min = 1 working day (8h)
    : null;

  return (
    <div className="space-y-4" data-testid="office-head-compliance">
      <PillTabs tabs={tabs} value={subTab} onChange={onSubTabChange} />

      <div {...tabPanelProps('ohd-compliance', 'charter')} hidden={subTab !== 'charter'} className="space-y-4 focus:outline-none">
        {scopedServices.length > 0 ? (
          <section className="card space-y-4 p-5 sm:p-6" data-testid="office-head-inspect-service">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h2 className="title-card">Inspect a Service</h2>
                <p className="mt-1 text-xs text-ink-muted sm:text-sm">Compare a specific service against its Citizen&rsquo;s Charter time limit.</p>
              </div>
              <div className="w-full sm:w-80">
                <label htmlFor="inspect-service" className="label">Service</label>
                <select
                  id="inspect-service"
                  className="input select-chevron"
                  value={selectedKey || `${selected?.office_id}:${selected?.service_id}`}
                  onChange={(e) => setSelectedKey(e.target.value)}
                >
                  {scopedServices.map((r) => {
                    const svcName = names.services?.[r.service_id] ?? r.service_code ?? 'Service';
                    return (
                      <option key={`${r.office_id}:${r.service_id}`} value={`${r.office_id}:${r.service_id}`}>
                        {svcName} &mdash; {minutesText(r.limit_minutes)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {selected ? (
              <div data-testid="inspect-service-detail">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-sans text-sm font-semibold text-ink">{selectedName}</h3>
                  {flagged ? (
                    <StatusBadge variant="warning" className="border border-[#E5B53A]">
                      Unusual Delay Flagged{varianceDays !== null ? ` (${varianceDays > 0 ? '+' : ''}${varianceDays}d variance)` : ''}
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-surface-muted/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Charter Standard</p>
                    <p className="mt-1 font-sans text-xl font-bold leading-tight tabular-nums text-ink">{minutesText(selected.limit_minutes)}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-muted/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">90th Percentile Turnaround</p>
                    <p className={`mt-1 font-sans text-xl font-bold leading-tight tabular-nums ${cmp === 'over' ? 'text-red-700' : 'text-ink'}`}>{minutesText(selected.p90_minutes)}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-muted/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Compliance Rate</p>
                    <p className="mt-1 font-sans text-xl font-bold leading-tight tabular-nums text-ink">{complianceRate !== null ? `${complianceRate}%` : '-'}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <DataTable
              label="Citizen's Charter service compliance summary"
              columns={[
                { key: 'service', header: "Citizen's Charter Service", render: (r) => <span className="td-primary">{names.services?.[r.service_id] ?? r.service_code ?? 'Service'}</span> },
                { key: 'standard', header: 'Official Charter Standard', render: (r) => <span className="td-num">{minutesText(r.limit_minutes)}</span> },
                { key: 'turnaround', header: '90th Pct. Turnaround', render: (r) => <span className="td-num">{minutesText(r.p90_minutes)}</span> },
                { key: 'volume', header: 'Volume (Completed)', align: 'right', className: 'tabular-nums', render: (r) => r.completed ?? 0 },
                {
                  key: 'rate',
                  header: 'Compliance Rate',
                  align: 'right',
                  render: (r) => {
                    const rate = Number.isFinite(Number(r.late_rate)) ? Math.round((100 - Number(r.late_rate)) * 10) / 10 : null;
                    return <span className="td-num font-semibold">{rate !== null ? `${rate}%` : '-'}</span>;
                  },
                },
                { key: 'status', header: 'Status', render: (r) => finding(r, minReliable) },
              ]}
              data={scopedServices}
              keyExtractor={(r) => `${r.office_id}:${r.service_id}`}
              emptyIcon="chart"
              emptyTitle="No Records for This Period"
              emptyMessage="No completed transactions were recorded during the selected reporting period."
              minWidth="42rem"
            />
          </section>
        ) : null}

        <ServiceCharterPanel
          key={`${period}:${scope.officeId}`}
          overview={overview}
          period={period}
          offices={offices}
          services={services}
          servicesLoaded={servicesLoaded}
          names={names}
          scope={scope}
          loading={loading}
          error={error}
          showUnusual={false}
        />
      </div>

      <div {...tabPanelProps('ohd-compliance', 'heatmap')} hidden={subTab !== 'heatmap'} className="focus:outline-none">
        <ComplianceHeatmap heatmap={heatmapView} scope={scope} />
      </div>

      <div {...tabPanelProps('ohd-compliance', 'unusual')} hidden={subTab !== 'unusual'} className="space-y-4 focus:outline-none">
        <UnusualCasesPanel overview={overview} names={names} scope={scope} loading={loading} error={error} />
        <CaseFlagsPanel overview={overview} ratings={ratings} ratingsLoading={ratingsLoading} names={names} scope={scope} />
      </div>

      {showSatisfaction ? (
        <div {...tabPanelProps('ohd-compliance', 'satisfaction')} hidden={subTab !== 'satisfaction'} className="focus:outline-none">
          <ClientSatisfactionPanel ratings={ratings} loading={ratingsLoading} names={names} scope={scope} />
        </div>
      ) : null}
    </div>
  );
}
