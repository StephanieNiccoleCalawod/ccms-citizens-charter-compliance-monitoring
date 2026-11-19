'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { ChartTableToggle, LegendItem } from '../charts/ChartCard.js';
import { getRequestForecast, retrainRequestForecast, getForecastOffices, getForecastServices } from '../../lib/api/request-forecast.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { notify } from '../../lib/ui/notify.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import RequestForecastChart from './RequestForecastChart.js';

// CC038 — Estimated requests section. Embedded in DashboardAnalytics (or standalone).

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-PH'));

/** Build chart data: 20 history rows + 5 forecast rows in a flat array for Recharts. */
function buildChartData(history, forecast) {
  const historical = history.map((h) => ({
    date: h.date,
    label: h.date ? h.date.slice(5) : '', // MM-DD
    actual: h.count,
    forecast: null,
    lower: null,
    upper: null,
  }));
  const projected = forecast.map((f) => ({
    date: f.date,
    label: f.date ? f.date.slice(5) : '',
    actual: null,
    forecast: f.point,
    lower: f.lower,
    upper: f.upper,
  }));
  return [...historical, ...projected];
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading forecast">
      <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
      <div className="card h-72 animate-pulse bg-slate-100" />
    </div>
  );
}

function AboutPanel({ run }) {
  if (!run || run.status !== 'SUCCESS') return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">
        About this forecast
      </summary>
      <div className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-transparent p-4 text-xs text-slate-600">
        <p><span className="font-semibold">Model:</span> {run.model?.name === 'HOLT_WINTERS_ADDITIVE' ? 'Holt-Winters Additive' : 'Seasonal Naive'}</p>
        <p><span className="font-semibold">Back-test MAE:</span> {run.model?.mae != null ? Number(run.model.mae).toFixed(2) : '—'} requests</p>
        <p><span className="font-semibold">Seasonal period:</span> 5 working days</p>
        <p><span className="font-semibold">Back-test horizon:</span> 5 working days</p>
        <p><span className="font-semibold">Historical working days used:</span> {run.historyWorkingDays ?? '—'}</p>
        <p><span className="font-semibold">Historical transaction count:</span> {n(run.historicalTransactionCount)}</p>
        <p><span className="font-semibold">Range calculation:</span> 10th–90th percentile of back-test residuals</p>
        <p><span className="font-semibold">Last generated:</span> {run.generatedAt ? formatDateTime(run.generatedAt) : '—'}</p>
      </div>
    </details>
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
        notify.success('Forecast retrained successfully.');
      } catch (err) {
        notify.error(err?.message ?? 'Retrain failed.');
      } finally {
        setRetraining(false);
      }
    });
  }

  const chartData = activeRun?.history?.length || activeRun?.forecast?.length
    ? buildChartData(activeRun.history ?? [], activeRun.forecast ?? [])
    : [];

  const firstForecastLabel = activeRun?.forecast?.[0]?.date?.slice(5) ?? null;
  const histDates = activeRun?.history ?? [];
  const fcDates = activeRun?.forecast ?? [];
  const histRange = histDates.length >= 2
    ? ` (${histDates[0].date?.slice(5)} – ${histDates.at(-1).date?.slice(5)})`
    : '';
  const fcRange = fcDates.length >= 2
    ? ` (${fcDates[0].date?.slice(5)} – ${fcDates.at(-1).date?.slice(5)})`
    : '';

  const selectedOfficeName = offices.find((o) => o.office_id === officeId)?.office_name || scopeLabel || '';
  const selectedServiceName = officeServices.find((s) => s.service_id === serviceId)?.service_name || 'All services (office level)';

  const boxClass = embedded ? '' : 'card p-4';
  const tableSection = activeRun?.status === 'SUCCESS' ? (
    <div className={embedded ? '' : 'mt-3'} data-testid="forecast-table-view">
      <TableShell>
        <Table
          label="5-day request volume forecast"
          head={
            <tr>
              <Th>Date</Th>
              <Th align="right">Estimated</Th>
              <Th align="right">Range</Th>
            </tr>
          }
        >
          {activeRun.forecast.map((f) => (
            <tr key={f.date} className="tr-row">
              <td className="td">{f.date}</td>
              <td className="td text-right font-semibold">{n(f.point)}</td>
              <td className="td text-right text-slate-500">{n(f.lower)}–{n(f.upper)}</td>
            </tr>
          ))}
        </Table>
      </TableShell>
      <AboutPanel run={activeRun} />
    </div>
  ) : null;

  return (
    <section className={embedded ? 'card flex h-full flex-col min-w-0 p-5 space-y-3' : 'space-y-3'} aria-labelledby="request-forecast-heading" data-testid="insights-forecast">
      {/* Section header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="request-forecast-heading" className={embedded ? 'title-card text-[#202938]' : 'text-base font-semibold text-slate-900'}>
              Request Volume Forecast
            </h3>
            {activeRun?.status === 'SUCCESS' ? (
              <span
                data-testid="forecast-total-badge"
                className="inline-flex items-center rounded-md border border-[#F0DDB0] bg-[#FEF3C7] px-2 py-0.5 font-mono text-[11px] font-bold text-[#78350F]"
              >
                {n(activeRun.weeklyTotal)} est. next 5 days
              </span>
            ) : null}
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
            >
              {retraining ? 'Retraining…' : 'Retrain'}
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
          <p className="text-sm text-slate-600">Choose an office above to see its 5-day request volume forecast.</p>
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

          {activeRun.status === 'NOT_ENOUGH_HISTORY' && (
            <div className={boxClass} data-testid="forecast-not-enough-history">
              <p className="text-sm text-slate-700">Not enough history yet (needs 4 weeks)</p>
              {activeRun.historyWorkingDays > 0 && (
                <p className="mt-1 text-xs text-slate-500">{activeRun.historyWorkingDays} working day{activeRun.historyWorkingDays !== 1 ? 's' : ''} recorded so far.</p>
              )}
            </div>
          )}

          {activeRun.status === 'TOO_FEW' && (
            <div className={boxClass} data-testid="forecast-too-few">
              <p className="text-sm text-slate-700">Not enough transactions to forecast for this service (needs 40).</p>
              <p className="mt-1 text-xs text-slate-500">Showing office-level forecast instead (if available).</p>
            </div>
          )}

          {activeRun.status === 'SUCCESS' && (
            <div className={embedded ? 'flex flex-1 flex-col' : 'card p-4'} data-testid="forecast-success">
              {viewMode === 'table' ? (
                tableSection
              ) : (
                <>
                  <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Forecast legend">
                    <LegendItem color="#800000" label={`Actual${histRange}`} />
                    <LegendItem color="#a37400" label={`Estimated${fcRange}`} dashed />
                    <LegendItem color="#FFDF00" label="Confidence band" shape="box" />
                  </ul>
                  <RequestForecastChart
                    data={chartData}
                    firstForecastDate={firstForecastLabel}
                    height={240}
                  />
                  <AboutPanel run={activeRun} />
                </>
              )}

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3 font-sans text-xs text-[#64748B]">
                <span>
                  Sum of 5-day point estimates:{' '}
                  <strong className="font-mono font-bold text-[#202938]">{n(activeRun.weeklyTotal)} requests</strong>
                </span>
                <span>
                  {!isOfficeBound ? 'Select an office in the top bar to switch' : 'Scoped to your assigned office'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {!activeLoading && !activeError && officeId && !activeRun && (
        <div className={boxClass} data-testid="forecast-empty">
          <p className="text-sm text-slate-500">No forecast available yet. The nightly job generates one; Super Admin can also retrain manually.</p>
        </div>
      )}

      {/* Retrain confirm */}
      <ConfirmDialog
        open={confirmRetrain}
        title="Retrain forecast?"
        message="This will recompute the forecast for the selected scope using the latest transaction data. Previous runs are kept."
        confirmLabel="Retrain"
        onConfirm={handleRetrain}
        onCancel={() => setConfirmRetrain(false)}
      />
    </section>
  );
}
