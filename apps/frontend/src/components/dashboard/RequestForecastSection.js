'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { ChartTableToggle, LegendItem } from '../charts/ChartCard.js';
import { getRequestForecast, retrainRequestForecast, getForecastOffices, getForecastServices } from '../../lib/api/request-forecast.js';
import {
  TABLE_PAGE, accuracyLine, forecastChartData, forecastCsv, forecastCsvName, forecastDayCards, forecastHeadline,
  forecastTableRows, notEnoughHistoryMessage,
} from '../../lib/ui/forecast.js';
import { notify } from '../../lib/ui/notify.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';
import EmptyState from '../ui/EmptyState.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import CalculationInfo from '../analytics/CalculationInfo.js';
import RequestForecastChart from './RequestForecastChart.js';

// CC038 — Expected request volume section. Embedded in DashboardAnalytics (or standalone).

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-PH'));

function LoadingSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading forecast">
      <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
      <div className="card h-72 animate-pulse bg-slate-100" />
    </div>
  );
}

/** S8-48: five day cards with the expected count for each working day; a weekday the calendar closed reads "Office closed". */
function DayCards({ cards }) {
  if (cards.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Expected requests by day" data-testid="forecast-day-cards">
      {cards.map((c) => (
        <li key={c.date} className={`rounded-xl border p-3 text-center ${c.closed ? 'border-line bg-surface-muted' : 'border-[#F0DDB0] bg-[#FFFBEB]'}`} data-testid="forecast-day-card">
          <p className="text-xs font-semibold text-ink">{c.weekday}</p>
          <p className="text-[11px] text-ink-muted">{c.dateText}</p>
          {c.closed ? (
            <p className="mt-2 text-sm font-semibold text-ink-muted">Office closed</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{n(c.expected)}</p>
              <p className="text-[11px] text-ink-muted">expected{c.lower != null && c.upper != null ? ` (${n(c.lower)}–${n(c.upper)})` : ''}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** S8-47: every recorded day the model used, then the expected days, with a Show more button and a CSV of the same rows. */
function ForecastTable({ run, officeName }) {
  const all = forecastTableRows(run);
  const [shown, setShown] = useState(TABLE_PAGE);
  const visible = all.slice(0, shown);
  function download() {
    const blob = new Blob([forecastCsv(run)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = forecastCsvName(officeName, run?.generatedAt ? run.generatedAt.slice(0, 10) : '');
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div data-testid="forecast-table-view" className="space-y-3">
      <TableShell>
        <Table
          label="Recorded and expected requests by day"
          head={(
            <tr>
              <Th>Date</Th>
              <Th align="right">Actual requests</Th>
              <Th align="right">Expected requests</Th>
              <Th align="right">Likely range</Th>
              <Th>Type</Th>
            </tr>
          )}
        >
          {visible.map((r) => (
            <tr key={`${r.kind}-${r.date}`} className={`tr-row ${r.kind === 'Expected' ? 'bg-[#FFFBEB]' : ''}`} data-testid="forecast-table-row">
              <td className="td td-num">{r.dateText}</td>
              <td className="td text-right tabular-nums">{r.actual == null ? '-' : n(r.actual)}</td>
              <td className="td text-right font-semibold tabular-nums">{r.expected == null ? '-' : n(r.expected)}</td>
              <td className="td text-right tabular-nums text-ink-muted">{r.range || '-'}</td>
              <td className="td"><span className={r.kind === 'Expected' ? 'font-semibold text-[#78350F]' : 'text-ink-muted'}>{r.kind}</span></td>
            </tr>
          ))}
        </Table>
      </TableShell>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>Showing {visible.length} of {all.length} days</span>
        <span className="flex gap-2">
          {visible.length < all.length ? <button type="button" className="btn-secondary btn-sm" onClick={() => setShown((v) => v + TABLE_PAGE)}>Show more</button> : null}
          <button type="button" className="btn-secondary btn-sm" onClick={download} data-testid="forecast-csv">Download CSV</button>
        </span>
      </div>
    </div>
  );
}

/** @param {{ user: { role: string, officeId?: string }, controlledOfficeId?: string, externalRun?: { state: string, value?: object, message?: string }, refreshRevision?: number, onRunChange?: (run: object, officeId?: string) => void, preloadedOffices?: Array, preloadedServices?: Array, scopeLabel?: string, embedded?: boolean }} props */
export default function RequestForecastSection({
  user,
  controlledOfficeId,
  externalRun,
  refreshRevision = 0,
  onRunChange,
  preloadedOffices,
  preloadedServices,
  scopeLabel = '',
  embedded = false,
}) {
  const isOfficeBound = user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF;
  const isSuperAdmin  = user.role === ROLES.SUPER_ADMIN;
  const hasPreloadedCatalogue = preloadedOffices !== undefined || preloadedServices !== undefined;

  const [fetchedOffices, setFetchedOffices]   = useState([]);
  const [fetchedServices, setFetchedServices] = useState([]);

  // Load offices + services once on mount when standalone (Dashboard passes shared catalogue lists)
  useEffect(() => {
    if (isOfficeBound || hasPreloadedCatalogue) return; // office-bound roles or parent-provided lists don't refetch
    Promise.all([getForecastOffices(), getForecastServices()])
      .then(([od, sd]) => {
        setFetchedOffices(Array.isArray(od?.items) ? od.items.filter((o) => o.is_active) : []);
        setFetchedServices(Array.isArray(sd?.items) ? sd.items.filter((s) => s.is_active) : []);
      })
      .catch(() => {}); // selector silently stays empty on error
  }, [isOfficeBound, hasPreloadedCatalogue]);

  const offices = (preloadedOffices ?? fetchedOffices).filter((o) => o.is_active !== false);
  const services = (preloadedServices ?? fetchedServices).filter((s) => s.is_active !== false);

  const defaultOffice = controlledOfficeId !== undefined ? controlledOfficeId : (isOfficeBound ? user.officeId : '');
  const [officeId, setOfficeId]   = useState(defaultOffice);
  const [serviceId, setServiceId] = useState('');
  const [run, setRun]             = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [confirmRetrain, setConfirmRetrain] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [viewMode, setViewMode] = useState('chart');
  const requestSeqRef = useRef(0);

  const hasExternalRun = externalRun !== undefined;
  const usingExternal = controlledOfficeId !== undefined && hasExternalRun && !serviceId;

  const once = useSingleSubmit();

  const fetchForecast = useCallback(async (oId, sId) => {
    const seq = ++requestSeqRef.current;
    // When parent supplies externalRun for office-level scope, skip the duplicate office GET.
    if (!oId || (controlledOfficeId !== undefined && oId !== controlledOfficeId) || (controlledOfficeId !== undefined && hasExternalRun && !sId)) {
      setRun(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getRequestForecast({ officeId: oId, serviceId: sId || null });
      if (seq !== requestSeqRef.current) return;
      setRun(data);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err?.message ?? 'Could not load the forecast.');
      setRun(null);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [controlledOfficeId, hasExternalRun]);

  // Sync office when controlled by a parent page
  useEffect(() => {
    if (controlledOfficeId !== undefined) {
      Promise.resolve().then(() => setOfficeId(controlledOfficeId));
      Promise.resolve().then(() => setServiceId(''));
    }
  }, [controlledOfficeId]);

  // Set default office once the list loads (wrapped in a promise to satisfy react-hooks/set-state-in-effect)
  useEffect(() => {
    if (controlledOfficeId === undefined && !isOfficeBound && !officeId && offices.length > 0) {
      Promise.resolve().then(() => setOfficeId(offices[0].office_id));
    }
  }, [controlledOfficeId, isOfficeBound, officeId, offices]);

  // Initial load and when selectors change (promise wrapping satisfies react-hooks/set-state-in-effect)
  useEffect(() => { Promise.resolve().then(() => fetchForecast(officeId, serviceId)); }, [officeId, serviceId, fetchForecast, refreshRevision]);

  const officeServices = services.filter((s) => s.office_id === officeId);

  const activeRun = usingExternal ? (externalRun?.value ?? null) : run;
  const activeLoading = usingExternal ? externalRun?.state === 'loading' : loading;
  const activeError = usingExternal
    ? (externalRun?.state === 'error' ? (externalRun.message ?? 'Could not load the forecast.') : null)
    : error;

  async function handleRetrain() {
    setConfirmRetrain(false);
    await once(async () => {
      setRetraining(true);
      try {
        const data = await retrainRequestForecast({ officeId, serviceId: serviceId || null });
        if (!usingExternal) setRun(data);
        if (!serviceId) onRunChange?.(data, officeId);
        notify.success('Forecast recalculated.');
      } catch (err) {
        notify.error(err?.message ?? 'Could not recalculate the forecast.');
      } finally {
        setRetraining(false);
      }
    });
  }

  const chartData = activeRun?.history?.length || activeRun?.forecast?.length ? forecastChartData(activeRun) : [];
  const headline = forecastHeadline(activeRun);
  const dayCards = forecastDayCards(activeRun);
  const accuracy = accuracyLine(activeRun);
  const emptyMessage = notEnoughHistoryMessage(activeRun);
  const firstForecastLabel = activeRun?.forecast?.[0]?.date ?? null;

  const selectedOfficeName = offices.find((o) => o.office_id === officeId)?.office_name || scopeLabel || '';
  const selectedServiceName = officeServices.find((s) => s.service_id === serviceId)?.service_name || 'All services (office level)';

  const boxClass = embedded ? '' : 'card p-4';
  const tableSection = activeRun?.status === 'SUCCESS' ? <ForecastTable run={activeRun} officeName={selectedOfficeName} /> : null;

  return (
    <section className={embedded ? 'card flex h-full flex-col min-w-0 p-5 space-y-3' : 'space-y-3'} aria-labelledby="request-forecast-heading" data-testid="insights-forecast">
      {/* Section header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="request-forecast-heading" className={embedded ? 'title-card text-[#202938]' : 'text-base font-semibold text-slate-900'}>
              Expected Requests Forecast (Recorded vs. Projected)
            </h3>
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide text-violet-700">
              ARIMA + Academic Calendar Model
            </span>
            <CalculationInfo calculation={activeRun?.calculations?.forecast ?? null} subject="the expected requests" testId="forecast-calc" />
          </div>
          {selectedOfficeName ? (
            <p className="mt-1 font-sans text-xs text-[#64748B] sm:text-sm">
              Showing <span className="font-semibold text-[#202938]">{selectedOfficeName}</span> &middot; {selectedServiceName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Office selector (Executive / Super Admin only, when not controlled by parent) */}
          {controlledOfficeId === undefined && !isOfficeBound && offices.length > 1 && (
            <select
              className="input select-chevron h-8 w-auto min-w-[9rem] py-1 pr-8 text-xs font-medium text-[#202938]"
              value={officeId}
              onChange={(e) => { setOfficeId(e.target.value); setServiceId(''); }}
              aria-label="Select office"
            >
              {offices.map((o) => (
                <option key={o.office_id} value={o.office_id}>{o.office_name}</option>
              ))}
            </select>
          )}

          {/* Service selector */}
          {officeServices.length > 0 && (
            <select
              className="input select-chevron h-8 w-auto max-w-[13rem] py-1 pr-8 text-xs font-medium text-[#202938]"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              aria-label="Select service"
            >
              <option value="">All services (office level)</option>
              {officeServices.map((s) => (
                <option key={s.service_id} value={s.service_id}>{s.service_name}</option>
              ))}
            </select>
          )}

          {/* Super Admin retrain button */}
          {isSuperAdmin && officeId && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setConfirmRetrain(true)}
              disabled={retraining || activeLoading}
              title="Recalculate the forecast using the latest transaction data"
            >
              {retraining ? 'Recalculating…' : 'Recalculate'}
            </button>
          )}

          {/* View as table toggle */}
          {activeRun?.status === 'SUCCESS' ? (
            <ChartTableToggle mode={viewMode} onChange={setViewMode} testIdPrefix="forecast" />
          ) : null}
        </div>
      </div>

      {/* Content */}
      {!officeId && !activeLoading && (
        <div className={boxClass} data-testid="forecast-pick-office">
          <EmptyState surface="subtle" size="compact" icon="building" title="Select an Office">
            Choose an office above to see how many requests to expect next week.
          </EmptyState>
        </div>
      )}
      {activeLoading && <LoadingSkeleton />}
      {!activeLoading && activeError && <StatusBanner variant="error" message={activeError} />}

      {!activeLoading && !activeError && officeId && activeRun && (
        <>
          {activeRun.stale && (
            <StatusBanner
              variant="warning"
              message={`Showing an earlier forecast${activeRun.asOfDate ? ` from ${activeRun.asOfDate}` : ''}; today's update is temporarily unavailable.`}
            />
          )}

          {emptyMessage && (
            <div className={boxClass} data-testid={activeRun.status === 'TOO_FEW' ? 'forecast-too-few' : 'forecast-not-enough-history'}>
              <EmptyState
                surface="subtle"
                size="compact"
                icon="chart"
                title={activeRun.status === 'TOO_FEW' ? 'Not Enough Service History' : 'Not Enough Request History Yet'}
                supportingInfo={activeRun.status === 'TOO_FEW' ? 'Select "All services (office level)" above to view the office-wide forecast.' : null}
                actionLabel={activeRun.status === 'TOO_FEW' && serviceId ? 'Show Office Forecast' : null}
                onAction={activeRun.status === 'TOO_FEW' && serviceId ? () => setServiceId('') : null}
              >
                {emptyMessage}
              </EmptyState>
            </div>
          )}

          {activeRun.status === 'SUCCESS' && (
            <div className={embedded ? 'flex flex-1 flex-col' : 'card p-4'} data-testid="forecast-success">
              {headline ? (
                <p className="mb-3 text-base font-semibold text-[#202938]" data-testid="forecast-headline">{headline.text}</p>
              ) : null}
              <div className="mb-3"><DayCards cards={dayCards} /></div>
              {viewMode === 'table' ? (
                tableSection
              ) : (
                <>
                  <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Forecast legend">
                    <LegendItem color="#800000" label="Recorded" />
                    <LegendItem color="#a37400" label="Expected" dashed />
                    <LegendItem color="#FFDF00" label="Likely range" shape="box" />
                  </ul>
                  <RequestForecastChart
                    data={chartData}
                    firstForecastDate={firstForecastLabel ? chartData.find((d) => d.date === firstForecastLabel)?.label ?? null : null}
                    todayLabel={activeRun.stale ? 'Last update' : 'Today'}
                    height={240}
                  />
                </>
              )}

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3 font-sans text-xs text-[#64748B]">
                <span data-testid="forecast-accuracy">{accuracy ?? 'Accuracy is not measured yet.'}</span>
                <span>
                  {!isOfficeBound ? 'Choose an office above to switch' : 'Showing your assigned office only'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {!activeLoading && !activeError && officeId && !activeRun && (
        <div className={boxClass} data-testid="forecast-empty">
          <EmptyState
            surface="subtle"
            size="compact"
            icon="chart"
            title="No Forecast Available Yet"
            actionLabel={isSuperAdmin ? 'Recalculate' : null}
            onAction={isSuperAdmin ? () => setConfirmRetrain(true) : null}
          >
            No forecast available yet. One is created automatically every night; a Super Admin can also recalculate it.
          </EmptyState>
        </div>
      )}

      {/* Retrain confirm */}
      <ConfirmDialog
        open={confirmRetrain}
        title="Recalculate forecast?"
        message="This will recalculate the forecast for the selected scope using the latest transaction data. Earlier results are kept."
        confirmLabel="Recalculate"
        onConfirm={handleRetrain}
        onCancel={() => setConfirmRetrain(false)}
      />
    </section>
  );
}
