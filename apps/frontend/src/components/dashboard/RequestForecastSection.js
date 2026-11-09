'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { apiFetch } from '../../lib/auth/session.js';
import { OFFICES_API, SERVICES_API } from '../../lib/api/catalogue.js';
import { getRequestForecast, retrainRequestForecast } from '../../lib/api/request-forecast.js';
import { notify } from '../../lib/ui/notify.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import RequestForecastChart from './RequestForecastChart.js';

// CC038 — Estimated requests section. Embedded in DashboardAnalytics.

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
        <p><span className="font-semibold">Last generated:</span> {run.generatedAt ? new Date(run.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}</p>
      </div>
    </details>
  );
}

/** @param {{ user: { role: string, officeId?: string } }} props */
export default function RequestForecastSection({ user }) {
  const isOfficeBound = user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF;
  const isSuperAdmin  = user.role === ROLES.SUPER_ADMIN;

  const [offices, setOffices]   = useState([]);
  const [services, setServices] = useState([]);

  // Load offices + services once on mount
  useEffect(() => {
    if (isOfficeBound) return; // office-bound roles don't need the list
    Promise.all([apiFetch(OFFICES_API), apiFetch(SERVICES_API)])
      .then(([od, sd]) => {
        setOffices(Array.isArray(od?.items) ? od.items.filter((o) => o.is_active) : []);
        setServices(Array.isArray(sd?.items) ? sd.items.filter((s) => s.is_active) : []);
      })
      .catch(() => {}); // selector silently stays empty on error
  }, [isOfficeBound]);

  const defaultOffice = isOfficeBound ? user.officeId : '';
  const [officeId, setOfficeId]   = useState(defaultOffice);
  const [serviceId, setServiceId] = useState('');
  const [run, setRun]             = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [confirmRetrain, setConfirmRetrain] = useState(false);

  const { submitting: retraining, submit: startRetrain } = useSingleSubmit();

  const fetchForecast = useCallback(async (oId, sId) => {
    if (!oId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getRequestForecast({ officeId: oId, serviceId: sId || null });
      setRun(data);
    } catch (err) {
      setError(err?.message ?? 'Could not load the forecast.');
      setRun(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Set default office once the list loads (wrapped in a promise to satisfy react-hooks/set-state-in-effect)
  useEffect(() => {
    if (!isOfficeBound && !officeId && offices.length > 0) {
      Promise.resolve().then(() => setOfficeId(offices[0].office_id));
    }
  }, [isOfficeBound, officeId, offices]);

  // Initial load and when selectors change (promise wrapping satisfies react-hooks/set-state-in-effect)
  useEffect(() => { Promise.resolve().then(() => fetchForecast(officeId, serviceId)); }, [officeId, serviceId, fetchForecast]);

  const officeServices = services.filter((s) => s.office_id === officeId);

  async function handleRetrain() {
    setConfirmRetrain(false);
    await startRetrain(async () => {
      try {
        const data = await retrainRequestForecast({ officeId, serviceId: serviceId || null });
        setRun(data);
        notify.success('Forecast retrained successfully.');
      } catch (err) {
        notify.error(err?.message ?? 'Retrain failed.');
      }
    });
  }

  const chartData = run?.history?.length || run?.forecast?.length
    ? buildChartData(run.history ?? [], run.forecast ?? [])
    : [];

  const firstForecastLabel = run?.forecast?.[0]?.date?.slice(5) ?? null;

  return (
    <section className="space-y-3" aria-labelledby="request-forecast-heading">
      {/* Section header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="request-forecast-heading" className="text-base font-semibold text-slate-900">
          Estimated requests
        </h2>

        {/* Office selector (Executive / Super Admin only) */}
        {!isOfficeBound && offices.length > 1 && (
          <select
            className="rounded-lg border border-slate-200 bg-transparent px-3 py-1.5 text-sm text-slate-700"
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
            className="rounded-lg border border-slate-200 bg-transparent px-3 py-1.5 text-sm text-slate-700"
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
        {isSuperAdmin && (
          <button
            type="button"
            className="ml-auto rounded-lg border border-slate-200 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setConfirmRetrain(true)}
            disabled={retraining || loading}
          >
            {retraining ? 'Retraining…' : 'Retrain'}
          </button>
        )}
      </div>

      {/* Content */}
      {loading && <LoadingSkeleton />}
      {!loading && error && <StatusBanner variant="error" message={error} />}

      {!loading && !error && run && (
        <>
          {run.status === 'NOT_ENOUGH_HISTORY' && (
            <div className="card p-4" data-testid="forecast-not-enough-history">
              <p className="text-sm text-slate-700">Not enough history yet (needs 4 weeks)</p>
              {run.historyWorkingDays > 0 && (
                <p className="mt-1 text-xs text-slate-500">{run.historyWorkingDays} working day{run.historyWorkingDays !== 1 ? 's' : ''} recorded so far.</p>
              )}
            </div>
          )}

          {run.status === 'TOO_FEW' && (
            <div className="card p-4" data-testid="forecast-too-few">
              <p className="text-sm text-slate-700">Not enough transactions to forecast for this service (needs 40).</p>
              <p className="mt-1 text-xs text-slate-500">Showing office-level forecast instead (if available).</p>
            </div>
          )}

          {run.status === 'SUCCESS' && (
            <div className="card p-4" data-testid="forecast-success">
              {/* Weekly total */}
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-maroon-950">{n(run.weeklyTotal)}</span>
                <span className="text-sm text-slate-500">estimated requests over the next 5 working days</span>
              </div>

              <RequestForecastChart
                data={chartData}
                firstForecastDate={firstForecastLabel}
              />

              {/* 5-day table */}
              <div className="mt-3">
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
                    {run.forecast.map((f) => (
                      <tr key={f.date} className="tr-row">
                        <td className="td">{f.date}</td>
                        <td className="td text-right font-semibold">{n(f.point)}</td>
                        <td className="td text-right text-slate-500">{n(f.lower)}–{n(f.upper)}</td>
                      </tr>
                    ))}
                  </Table>
                </TableShell>
              </div>

              <AboutPanel run={run} />
            </div>
          )}
        </>
      )}

      {!loading && !error && !run && (
        <div className="card p-4" data-testid="forecast-empty">
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
