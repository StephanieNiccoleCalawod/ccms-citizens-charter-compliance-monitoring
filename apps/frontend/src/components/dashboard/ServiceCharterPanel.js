'use client';

import CalculationInfo from '../analytics/CalculationInfo.js';
import { useMemo, useRef, useState } from 'react';
import { getInsightsCell } from '../../lib/api/insights.js';
import {
  CHARTER_SHOW_OPTIONS,
  CHARTER_SORT_OPTIONS,
  FLAG_HELP,
  FLAG_LABEL,
  MIN_CELL_COMPLETED,
  durationComparisonStatus,
  filterCharterRows,
  isCharterLowSample,
  minutesText,
  sortCharterRows,
} from '../../lib/ui/insights.js';
import { notify } from '../../lib/ui/notify.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';
import ServiceCellDetail from './ServiceCellDetail.js';
import ServiceLateRateMatrix from './ServiceLateRateMatrix.js';
import UnusualCasesPanel from './UnusualCasesPanel.js';

const label = (id, map, fallback) => map?.[id] ?? fallback;

function renderCharterFinding(row, minReliable) {
  if (isCharterLowSample(row, minReliable)) {
    const lowLabel = row.flags?.includes('NOT_ENOUGH_DATA') ? FLAG_LABEL.NOT_ENOUGH_DATA : 'Too few to judge';
    return (
      <StatusBadge variant="neutral" className="border border-slate-200" title={FLAG_HELP.NOT_ENOUGH_DATA}>
        {lowLabel}
      </StatusBadge>
    );
  }
  if (row.flags?.includes('LIMIT_OFTEN_MISSED') || Number(row.late_rate) > 20) {
    return (
      <StatusBadge variant="danger" className="border border-red-200" title={FLAG_HELP.LIMIT_OFTEN_MISSED}>
        {FLAG_LABEL.LIMIT_OFTEN_MISSED}
      </StatusBadge>
    );
  }
  if (row.flags?.includes('LIMIT_FAR_LONGER')) {
    return (
      <StatusBadge variant="warning" className="border border-[#E5B53A]" title={FLAG_HELP.LIMIT_FAR_LONGER}>
        {FLAG_LABEL.LIMIT_FAR_LONGER}
      </StatusBadge>
    );
  }
  if (durationComparisonStatus(row) === 'over') {
    return (
      <StatusBadge variant="warning" className="border border-[#E5B53A]">
        Over limit
      </StatusBadge>
    );
  }
  if (Number(row.late_rate) > 10) {
    return (
      <StatusBadge variant="warning" className="border border-[#E5B53A]">
        Watch
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="success" className="border border-emerald-200">
      Within limit
    </StatusBadge>
  );
}

/**
 * Service bottleneck matrix ("Late Rate by Office & Service"), the Charter Time Limits by Service table,
 * and permission-gated Unusual Delays on the main Dashboard without triggering extra initial fetches.
 */
export default function ServiceCharterPanel({
  overview,
  period = 'monthly',
  offices = [],
  services = [],
  servicesLoaded = true,
  names = {},
  scope = { kind: 'campus', officeId: null },
  loading = false,
  error = null,
  showUnusual = true,
}) {
  const [flagFilter, setFlagFilter] = useState('');
  const [sortKey, setSortKey] = useState('late_rate');
  const [charterCell, setCharterCell] = useState(null);
  const [charterCellData, setCharterCellData] = useState(null);
  const cellSeqRef = useRef(0);

  const minReliable = Number(overview?.min_cell_completed) || MIN_CELL_COMPLETED;
  const scopedOffice = scope?.kind === 'office' && scope?.officeId ? String(scope.officeId).toLowerCase() : null;

  const scopedServices = useMemo(() => {
    const raw = overview?.charter?.services ?? [];
    if (!scopedOffice) return raw;
    return raw.filter((r) => String(r.office_id ?? '').toLowerCase() === scopedOffice);
  }, [overview, scopedOffice]);

  const servicesList = useMemo(
    () => sortCharterRows(filterCharterRows(scopedServices, flagFilter, { minReliable }), sortKey, names),
    [scopedServices, flagFilter, minReliable, sortKey, names],
  );

  async function openCharterCell(row) {
    if (!row || Number(row.completed) <= 0) return;
    const seq = ++cellSeqRef.current;
    const serviceName = label(row.service_id, names.services, row.service_code);
    const officeName = label(row.office_id, names.offices, 'Office');
    setCharterCell({
      ...row,
      service_name: serviceName,
      office_name: officeName,
      too_few: Number(row.completed) < minReliable,
    });
    setCharterCellData(null);
    try {
      const detail = await getInsightsCell({ officeId: row.office_id, serviceId: row.service_id, period });
      if (seq === cellSeqRef.current) setCharterCellData(detail);
    } catch (failure) {
      if (seq === cellSeqRef.current) {
        setCharterCellData(null);
        notify.error(failure?.message || 'Detail could not be loaded.');
      }
    }
  }

  const charterCols = [
    {
      key: 'service',
      header: 'Service',
      width: '34%',
      render: (r) => {
        const svcName = label(r.service_id, names.services, r.service_code || 'Service');
        const officeName = label(r.office_id, names.offices, 'Office');
        const interactive = Number(r.completed) > 0;
        return (
          <div className="min-w-0 space-y-0.5 whitespace-normal break-words">
            {interactive ? (
              <button
                type="button"
                onClick={() => openCharterCell(r)}
                data-testid="charter-service-btn"
                className="cursor-pointer rounded text-left td-primary transition-colors hover:text-pup-maroon hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon"
              >
                {svcName}
              </button>
            ) : (
              <span className="block td-primary">{svcName}</span>
            )}
            <p className="td-secondary">
              <span>{officeName}</span>
            </p>
          </div>
        );
      },
    },
    {
      key: 'completed',
      header: 'Completed',
      width: '10%',
      align: 'center',
      render: (r) => <span className="td-num">{r.completed ?? 0}</span>,
    },
    {
      key: 'late',
      header: 'Late',
      width: '18%',
      render: (r) => {
        const rate = Math.max(0, Math.min(100, Number(r.late_rate) || 0));
        const barColor = rate > 20 ? 'bg-red-600' : rate > 10 ? 'bg-amber-500' : 'bg-emerald-600';
        const lowSample = Number(r.completed) < minReliable;
        return (
          <div
            className="flex items-center gap-2.5"
            title={lowSample ? `Fewer than ${minReliable} completed transactions — low sample` : undefined}
          >
            <span className="w-5 shrink-0 text-right td-num">
              {r.late ?? '—'}
            </span>
            <div
              role="progressbar"
              aria-valuenow={rate}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${r.late_rate ?? 0}% late`}
              className="h-2 min-w-[3.25rem] max-w-[5.25rem] flex-1 overflow-hidden rounded-full bg-[#E2E8F0]"
            >
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${rate}%` }} />
            </div>
            <span className="w-11 shrink-0 text-right td-num font-semibold">
              {r.late_rate != null ? `${r.late_rate}%` : '—'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'duration',
      header: 'Charter limit → 9 in 10 done within',
      width: '22%',
      render: (r) => {
        const cmp = durationComparisonStatus(r);
        return (
          <div className="space-y-0.5 whitespace-normal">
            <p className="font-sans text-xs font-medium tabular-nums text-[#202938]">
              {minutesText(r.limit_minutes)} → {minutesText(r.p90_minutes)}
            </p>
            {cmp === 'over' ? (
              <p className="font-sans text-xs font-semibold text-red-700">Over limit</p>
            ) : cmp === 'within' ? (
              <p className="font-sans text-xs font-semibold text-emerald-700">Within limit</p>
            ) : (
              <p className="font-sans text-xs text-[#64748B]">Insufficient timing data</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'finding',
      header: 'Finding',
      width: '16%',
      render: (r) => renderCharterFinding(r, minReliable),
    },
  ];

  const charterEmptyMessage = scopedServices.length === 0
    ? 'No completed transactions during this period.'
    : flagFilter === 'flagged'
      ? 'No flagged services found in this period.'
      : flagFilter === 'too_few'
        ? 'No services with too few completed transactions.'
        : 'No services found.';

  if (!overview && !loading && !error) return null;

  return (
    <div className="space-y-4">
      <ServiceLateRateMatrix
        overview={overview}
        period={period}
        offices={offices}
        services={services}
        servicesLoaded={servicesLoaded}
        names={names}
        scope={scope}
      />

      <Card id="charter" as="section" aria-label="Charter time limits by service" padding="md" className="space-y-4 sm:p-6" data-testid="insights-charter">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-2xl font-normal leading-tight text-[#202938]">Charter Time Limits by Service</h3>
              <CalculationInfo calculation={overview?.calculations?.charter_summary ?? null} subject="the charter time limits" testId="charter-calc" />
            </div>
            <p className="mt-1 font-sans text-sm text-[#64748B]">
              Compares each service with its Citizen&rsquo;s Charter time limit. Services with too few completed transactions are shown but not judged.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-48">
              <label htmlFor="charter-filter" className="label">Show</label>
              <select
                id="charter-filter"
                className="input select-chevron"
                value={flagFilter}
                onChange={(e) => setFlagFilter(e.target.value)}
                data-testid="charter-filter"
              >
                {CHARTER_SHOW_OPTIONS.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="w-full sm:w-56">
              <label htmlFor="charter-sort" className="label">Sort by</label>
              <select
                id="charter-sort"
                className="input select-chevron"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                data-testid="charter-sort"
              >
                {CHARTER_SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>

        <DataTable
          label="Charter time limits by service"
          columns={charterCols}
          data={servicesList}
          keyExtractor={(r) => `${r.office_id}-${r.service_id}`}
          loading={loading}
          error={error}
          emptyTitle={
            scopedServices.length === 0
              ? 'No Records for This Period'
              : flagFilter === 'flagged'
                ? 'No Flagged Services Found'
                : flagFilter === 'too_few'
                  ? 'No Matching Services Found'
                  : 'No Matching Services Found'
          }
          emptyVariant={scopedServices.length === 0 ? 'neutral' : flagFilter === 'flagged' ? 'success' : 'search'}
          emptyIcon={scopedServices.length === 0 ? 'chart' : undefined}
          emptyActionLabel={scopedServices.length > 0 && flagFilter ? 'Show All Services' : undefined}
          onEmptyAction={scopedServices.length > 0 && flagFilter ? () => setFlagFilter('') : undefined}
          emptyMessage={charterEmptyMessage}
          minWidth="52rem"
        />

        <ServiceCellDetail
          cell={charterCell}
          cellData={charterCellData}
          onClose={() => setCharterCell(null)}
          testId="charter-cell-detail"
          summaryTestId="charter-cell-summary"
        />

        {showUnusual ? (
          <UnusualCasesPanel
            overview={overview}
            names={names}
            scope={scope}
            loading={loading}
            error={error}
            embedded
          />
        ) : null}
      </Card>
    </div>
  );
}
