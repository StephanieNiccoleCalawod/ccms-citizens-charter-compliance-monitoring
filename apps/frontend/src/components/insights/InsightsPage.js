'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { OFFICES_API, SERVICES_API } from '../../lib/api/catalogue.js';
import { fetchAllPages } from '../../lib/api/client.js';
import { getInsightsCell, getInsightsOverview, getOfficeForecast, getOfficeLateRisk, retrainOfficeModels } from '../../lib/api/insights.js';
import { apiFetch } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { FLAG_HELP, FLAG_LABEL, PERIODS, filterByFlag, heatClass, heatLabel, minutesText, sentenceText, sortRows } from '../../lib/ui/insights.js';
import { notify } from '../../lib/ui/notify.js';
import { seededHistoryDisclosure } from '../../lib/ui/seeded-history.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import DataTable from '../ui/DataTable.js';

// Insights (CC053 / CC054): pulse, heatmap with a click-through detail, plain-language sentences, the Charter check and unusual cases.
// Late-risk and forecast come from Operations for one office; when that fails the tile says "not available".
const Tile = ({ label, value, note, testId }) => (
  <div className="card p-4" data-testid={testId}>
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold text-maroon-950">{value}</p>
    {note ? <p className="mt-1 text-xs text-slate-600">{note}</p> : null}
  </div>
);
const rate = (v) => (v === null || v === undefined ? '–' : `${v}%`);

export default function InsightsPage({ user }) {
  const isAdmin = user?.role === ROLES.SUPER_ADMIN;
  const [period, setPeriod] = useState('monthly');
  const [officeId, setOfficeId] = useState('');
  const [offices, setOffices] = useState([]);
  const [services, setServices] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cell, setCell] = useState(null);
  const [cellData, setCellData] = useState(null);
  const [risk, setRisk] = useState({ state: 'idle' });
  const [forecast, setForecast] = useState({ state: 'idle' });
  const [flagFilter, setFlagFilter] = useState('');
  const [sortKey, setSortKey] = useState('late_rate');
  const [retraining, setRetraining] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.allSettled([fetchAllPages(OFFICES_API, apiFetch), fetchAllPages(SERVICES_API, apiFetch)]).then(([o, s]) => {
      if (!live) return;
      if (o.status === 'fulfilled') setOffices(o.value);
      if (s.status === 'fulfilled') setServices(s.value);
    });
    return () => { live = false; };
  }, []);

  const names = useMemo(() => ({
    offices: Object.fromEntries(offices.map((o) => [o.office_id, o.office_name])),
    services: Object.fromEntries(services.map((s) => [s.service_id, s.service_name])),
  }), [offices, services]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await getInsightsOverview({ period, officeId })); } catch (failure) { setError(failure?.message || 'Insights could not be loaded.'); } finally { setLoading(false); }
  }, [period, officeId]);
  useEffect(() => { load(); }, [load]);

  const modelOffice = officeId || data?.scope?.office_id || '';
  const loadModels = useCallback(async () => {
    if (!modelOffice) { setRisk({ state: 'pick' }); setForecast({ state: 'pick' }); return; }
    setRisk({ state: 'loading' }); setForecast({ state: 'loading' });
    const [r, f] = await Promise.allSettled([getOfficeLateRisk(modelOffice), getOfficeForecast(modelOffice)]);
    setRisk(r.status === 'fulfilled' ? { state: 'ok', value: r.value } : { state: 'error' });
    setForecast(f.status === 'fulfilled' ? { state: 'ok', value: f.value } : { state: 'error' });
  }, [modelOffice]);
  useEffect(() => { loadModels(); }, [loadModels]);

  async function openCell(c) {
    setCell(c); setCellData(null);
    try { setCellData(await getInsightsCell({ officeId: c.office_id, serviceId: c.service_id, period })); } catch (failure) { notify.error(failure?.message || 'Detail could not be loaded.'); }
  }
  async function retrain() {
    setRetraining(true);
    const results = await retrainOfficeModels(modelOffice);
    setRetraining(false);
    if (results.every((r) => r.status === 'fulfilled')) notify.success('Models retrained.'); else notify.error('One or both models could not be retrained.');
    loadModels();
  }

  const pulse = data?.pulse;
  const highCount = risk.state === 'ok' ? (risk.value?.items ?? []).filter((i) => i.level === 'HIGH').length : null;
  const services_ = useMemo(() => sortRows(filterByFlag(data?.charter?.services ?? [], flagFilter), sortKey), [data, flagFilter, sortKey]);
  const disclosure = seededHistoryDisclosure();
  const heat = data?.heatmap ?? [];
  const heatOffices = [...new Set(heat.map((c) => c.office_id))];
  const heatServices = [...new Map(heat.map((c) => [c.service_id, c.service_code])).entries()];
  const label = (id, map, fallback) => map[id] ?? fallback;

  const charterCols = [
    { key: 'service', header: 'Service', render: (r) => `${label(r.service_id, names.services, r.service_code)} · ${label(r.office_id, names.offices, '')}` },
    { key: 'completed', header: 'Completed', align: 'right', render: (r) => r.completed },
    { key: 'late_rate', header: 'Late', align: 'right', render: (r) => `${r.late_rate}%` },
    { key: 'limit', header: 'Charter limit', align: 'right', render: (r) => minutesText(r.limit_minutes) },
    { key: 'p90', header: '9 in 10 done within', align: 'right', render: (r) => minutesText(r.p90_minutes) },
    { key: 'flags', header: 'Finding', render: (r) => (r.flags.length ? r.flags.map((f) => <span key={f} title={FLAG_HELP[f]} className="mr-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{FLAG_LABEL[f]}</span>) : <span className="text-xs text-slate-500">No finding</span>) },
  ];
  const unusualCols = [
    { key: 'tracking_no', header: 'Transaction', render: (r) => r.tracking_no },
    { key: 'service', header: 'Service', render: (r) => label(r.service_id, names.services, r.service_code) },
    { key: 'elapsed', header: 'Took', align: 'right', render: (r) => minutesText(r.elapsed_minutes) },
    { key: 'limit', header: 'Charter limit', align: 'right', render: (r) => minutesText(r.limit_minutes) },
    { key: 'ended', header: 'Finished', render: (r) => formatDateTime(r.ended_at) },
  ];

  return (
    <div className="space-y-6" data-testid="insights-page">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Period
          <select className="input ml-2" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="insights-period">
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {user?.role !== ROLES.OFFICE_HEAD && user?.role !== ROLES.OFFICE_STAFF ? (
          <label className="text-sm font-semibold">Office
            <select className="input ml-2" value={officeId} onChange={(e) => setOfficeId(e.target.value)} data-testid="insights-office">
              <option value="">Whole campus</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {loading && !data ? <p className="text-sm text-slate-600">Loading…</p> : null}

      {data ? (<>
        <section aria-label="Pulse" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile testId="pulse-open" label="Open now" value={pulse.open_now} note={pulse.oldest_open_age_minutes != null ? `Oldest open ${minutesText(pulse.oldest_open_age_minutes)}` : null} />
          <Tile testId="pulse-today" label="Completed today" value={pulse.completed_today} note={`${pulse.received_today} received today`} />
          <Tile testId="pulse-ontime" label="On time" value={rate(pulse.on_time_rate)} note={pulse.previous_on_time_rate != null ? `Previous period ${pulse.previous_on_time_rate}%` : 'No earlier period to compare'} />
          <Tile testId="pulse-high" label="High late-risk" value={highCount === null ? 'Not available' : highCount} note={risk.state === 'pick' ? 'Choose an office' : null} />
        </section>

        <section aria-label="What stands out" className="card p-4" data-testid="insights-sentences">
          <h2 className="text-lg font-bold text-maroon-950">What stands out</h2>
          {data.sentences.length === 0 ? <p className="mt-2 text-sm text-slate-600">Not enough completed transactions in this period to say anything yet.</p> : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{data.sentences.map((s) => <li key={s.id} data-testid={`sentence-${s.template}`}>{sentenceText(s, names)}</li>)}</ul>
          )}
        </section>

        <section aria-label="Heatmap" className="card p-4" data-testid="insights-heatmap">
          <h2 className="text-lg font-bold text-maroon-950">Late rate by office and service</h2>
          <p className="text-xs text-slate-600">Grey means fewer than {data.min_cell_completed} completed, too few to judge. Select a cell for its detail.</p>
          {heat.length === 0 ? <p className="mt-2 text-sm text-slate-600">No completed transactions in this period.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-xs">
                <caption className="sr-only">Late rate for each office and service</caption>
                <thead><tr><th scope="col" className="text-left">Office</th>{heatServices.map(([id, code]) => <th scope="col" key={id} title={names.services[id]}>{code}</th>)}</tr></thead>
                <tbody>{heatOffices.map((o) => (
                  <tr key={o}><th scope="row" className="text-left font-semibold">{label(o, names.offices, 'Office')}</th>
                    {heatServices.map(([sid]) => {
                      const c = heat.find((x) => x.office_id === o && x.service_id === sid);
                      return <td key={sid} className="p-0">{c ? <button type="button" className={`w-full rounded px-2 py-2 font-semibold ${heatClass(c)}`} onClick={() => openCell(c)} data-testid="heat-cell">{heatLabel(c)}</button> : null}</td>;
                    })}
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {cell ? (
            <div className="mt-4 rounded border border-slate-200 p-3 text-sm" data-testid="cell-detail">
              <div className="flex justify-between"><h3 className="font-bold">{label(cell.service_id, names.services, cell.service_code)} · {label(cell.office_id, names.offices, '')}</h3><button type="button" className="btn-secondary" onClick={() => setCell(null)}>Close</button></div>
              {!cellData ? <p>Loading…</p> : (<>
                <p className="mt-2 font-semibold">Weekly late rate</p>
                <ul className="list-disc pl-5">{cellData.weekly.map((w) => <li key={w.week_start}>Week of {w.week_start}: {w.late_rate}% late ({w.late} of {w.completed})</li>)}</ul>
                <p className="mt-2 font-semibold">Late transactions</p>
                {cellData.late_transactions.length === 0 ? <p>None in this period.</p> : <ul className="list-disc pl-5">{cellData.late_transactions.map((t) => <li key={t.tracking_no}>{t.tracking_no} · {minutesText(t.variance_minutes)} over the limit</li>)}</ul>}
              </>)}
            </div>
          ) : null}
        </section>

        <section aria-label="Charter check" className="space-y-2" data-testid="insights-charter">
          <h2 className="text-lg font-bold text-maroon-950">Charter check</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <label>Show <select className="input" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} data-testid="charter-filter">
              <option value="">All services</option>
              {Object.entries(FLAG_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
            <label>Sort by <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="late_rate">Late rate</option><option value="completed">Completed</option><option value="p90_minutes">Time taken</option>
            </select></label>
          </div>
          <DataTable columns={charterCols} data={services_} keyExtractor={(r) => `${r.office_id}-${r.service_id}`} emptyMessage="No services to check in this period." minWidth="46rem" />
          <h3 className="pt-2 font-bold text-maroon-950">Unusual cases</h3>
          <p className="text-xs text-slate-600">Transactions that took far longer than is normal for their service. Shown only for services with at least {data.charter.thresholds.min_completed} completed.</p>
          <DataTable columns={unusualCols} data={data.charter.unusual} keyExtractor={(r) => r.transaction_id} emptyMessage="No unusual cases." minWidth="38rem" />
        </section>

        <section aria-label="Forecast and models" className="card p-4" data-testid="insights-models">
          <h2 className="text-lg font-bold text-maroon-950">Forecast and models</h2>
          {forecast.state === 'pick' ? <p className="text-sm text-slate-600">Choose an office to see its forecast and late-risk model.</p> : null}
          {forecast.state === 'error' || risk.state === 'error' ? <p className="text-sm text-slate-600">Forecast or late-risk is not available right now.</p> : null}
          {forecast.state === 'ok' && forecast.value?.status === 'READY' ? <p className="text-sm">Expected this week: <strong>{forecast.value.weeklyTotal}</strong> requests (typical error ±{forecast.value.model?.mae}).</p> : null}
          {forecast.state === 'ok' && forecast.value?.status !== 'READY' ? <p className="text-sm text-slate-600">The forecast is not ready for this office yet.</p> : null}
          {risk.state === 'ok' && risk.value?.model ? <p className="text-sm">Late-risk model: {risk.value.model.method === 'trained' ? 'trained' : 'rule-based'}{risk.value.model.metrics ? `, accuracy ${Math.round(risk.value.model.metrics.accuracy * 100)}%` : ''}.</p> : null}
          {isAdmin && modelOffice ? <button type="button" className="btn-primary mt-3" disabled={retraining} onClick={retrain} data-testid="insights-retrain">{retraining ? 'Retraining…' : 'Retrain models'}</button> : null}
        </section>

        <section aria-label="About these numbers" className="card p-4 text-sm" data-testid="insights-about">
          <h2 className="text-lg font-bold text-maroon-950">About these numbers</h2>
          <p>{data.about.completed_rows} completed transactions and {data.about.late_cases} late cases are in the store{data.about.earliest_started_at ? `, from ${formatDateTime(data.about.earliest_started_at)}` : ''}. Updated {formatDateTime(data.generated_at)}.</p>
          {disclosure ? <p className="mt-1" data-testid="insights-disclosure">{disclosure}</p> : null}
        </section>
      </>) : null}
    </div>
  );
}
