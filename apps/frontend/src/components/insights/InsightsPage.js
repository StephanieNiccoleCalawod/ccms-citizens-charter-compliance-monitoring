'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { OFFICES_API, SERVICES_API } from '../../lib/api/catalogue.js';
import { fetchAllPages } from '../../lib/api/client.js';
import { getInsightsCell, getInsightsOverview, getOfficeForecast, getOfficeLateRisk, retrainOfficeModels } from '../../lib/api/insights.js';
import { apiFetch } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { FLAG_HELP, FLAG_LABEL, PERIODS, filterByFlag, heatClass, heatLabel, minutesText, sentenceText, sortRows, CHART_ANCHOR, forecastSentence, highRiskSentence, mergeSentences, todayForecast } from '../../lib/ui/insights.js';
import { notify } from '../../lib/ui/notify.js';
import { seededHistoryDisclosure } from '../../lib/ui/seeded-history.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import FilterBar from '../forms/FilterBar.js';
import Button from '../ui/Button.js';
import DataTable from '../ui/DataTable.js';
import EmptyState from '../ui/EmptyState.js';
import LoadingState from '../ui/LoadingState.js';
import StatCard from '../ui/StatCard.js';
import StatusBadge from '../ui/StatusBadge.js';
import TableShell, { RowHeader, Table, Th } from '../ui/TableShell.js';

// Insights (CC053 / CC054): pulse, heatmap with a click-through detail, plain-language sentences, the Charter check and unusual cases.
// Late-risk and forecast come from Operations for one office; when that fails the tile says "not available".

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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the overview again when the period or office changes
  useEffect(() => { load(); }, [load]);

  const modelOffice = officeId || data?.scope?.office_id || '';
  const loadModels = useCallback(async () => {
    if (!modelOffice) { setRisk({ state: 'pick' }); setForecast({ state: 'pick' }); return; }
    setRisk({ state: 'loading' }); setForecast({ state: 'loading' });
    const [r, f] = await Promise.allSettled([getOfficeLateRisk(modelOffice), getOfficeForecast(modelOffice)]);
    setRisk(r.status === 'fulfilled' ? { state: 'ok', value: r.value } : { state: 'error' });
    setForecast(f.status === 'fulfilled' ? { state: 'ok', value: f.value } : { state: 'error' });
  }, [modelOffice]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the late-risk and forecast models again when the office changes (also after Retrain)
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
  const sentences = useMemo(() => (data ? mergeSentences(data.sentences, [forecastSentence(forecast.state === 'ok' ? forecast.value : null, modelOffice), highRiskSentence(risk.state === 'ok' ? risk.value : null)], data.max_sentences ?? 6) : []), [data, forecast, risk, modelOffice]);
  const todays = useMemo(() => todayForecast(forecast.state === 'ok' ? forecast.value : null, pulse), [forecast, pulse]);
  const riskModel = risk.state === 'ok' ? risk.value?.model : null;
  const fcModel = forecast.state === 'ok' && forecast.value?.status === 'SUCCESS' ? forecast.value.model : null;
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
    { key: 'flags', header: 'Finding', render: (r) => (r.flags.length ? r.flags.map((f) => <StatusBadge key={f} variant="warning" title={FLAG_HELP[f]} className="mr-1">{FLAG_LABEL[f]}</StatusBadge>) : <span className="text-xs text-slate-500">No finding</span>) },
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
      <FilterBar label="Insights filters">
        <div className="w-full sm:w-48">
          <label htmlFor="insights-period" className="label">Period</label>
          <select id="insights-period" className="input select-chevron" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="insights-period">
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {user?.role !== ROLES.OFFICE_HEAD && user?.role !== ROLES.OFFICE_STAFF ? (
          <div className="w-full sm:w-72">
            <label htmlFor="insights-office" className="label">Office</label>
            <select id="insights-office" className="input select-chevron" value={officeId} onChange={(e) => setOfficeId(e.target.value)} data-testid="insights-office">
              <option value="">Whole campus</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select>
          </div>
        ) : null}
      </FilterBar>
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {loading && !data ? <LoadingState>Loading insights…</LoadingState> : null}

      {data ? (<>
        <section aria-label="Pulse" id="insights-pulse" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard testId="pulse-open" label="Open now" value={pulse.open_now} note={pulse.oldest_open_age_minutes != null ? `Oldest open ${minutesText(pulse.oldest_open_age_minutes)}` : null} />
          <StatCard testId="pulse-high" label="At risk now (High)" value={highCount === null ? 'Not available' : highCount} tone={highCount ? 'danger' : 'default'} note={risk.state === 'pick' ? 'Choose an office' : null} />
          <StatCard testId="pulse-today" label="Completed today" value={pulse.completed_today} note={`${pulse.received_today} received today`} />
          <StatCard testId="pulse-forecast" label="Today's forecast" value={todays ? `${todays.expected}` : 'Not available'} note={todays ? `${todays.status === 'behind' ? 'Behind' : 'On track'} (expected ${todays.lower} to ${todays.upper})` : forecast.state === 'pick' ? 'Choose an office' : null} />
        </section>

        <section aria-label="What stands out" className="card p-5" data-testid="insights-sentences">
          <h2 className="title-card">What stands out</h2>
          {sentences.length === 0 ? <p className="mt-2 text-sm text-slate-600">Not enough completed transactions in this period to say anything yet.</p> : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{sentences.map((s) => <li key={s.id} data-testid={`sentence-${s.template}`}>{sentenceText(s, names)} <a className="text-xs font-semibold underline" href={`#${CHART_ANCHOR[s.chart] ?? ''}`}>See the numbers</a></li>)}</ul>
          )}
        </section>

        <section aria-label="Heatmap" id="insights-heatmap" className="card p-5" data-testid="insights-heatmap">
          <h2 className="title-card">Late rate by office and service</h2>
          <p className="mt-1 text-xs text-slate-600">Grey means fewer than {data.min_cell_completed} completed, too few to judge. Select a cell for its detail.</p>
          {heat.length === 0 ? <EmptyState className="mt-3">No completed transactions in this period.</EmptyState> : (
            <div className="mt-3">
              <TableShell>
                <Table
                  label="Late rate for each office and service"
                  minWidth="32rem"
                  head={<tr><Th>Office</Th>{heatServices.map(([id, code]) => <Th key={id} align="center" title={names.services[id]}>{code}</Th>)}</tr>}
                >
                  {heatOffices.map((o) => (
                    <tr key={o}>
                      <RowHeader>{label(o, names.offices, 'Office')}</RowHeader>
                      {heatServices.map(([sid]) => {
                        const c = heat.find((x) => x.office_id === o && x.service_id === sid);
                        return <td key={sid} className="p-0.5 text-center text-xs">{c ? <button type="button" className={`w-full rounded-control px-2 py-2 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon ${heatClass(c)}`} onClick={() => openCell(c)} data-testid="heat-cell">{heatLabel(c)}</button> : null}</td>;
                      })}
                    </tr>
                  ))}
                </Table>
              </TableShell>
            </div>
          )}
          {cell ? (
            <div className="mt-4 rounded-card border border-line bg-surface-muted p-4 text-sm" data-testid="cell-detail">
              <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-sans text-sm font-bold text-slate-900">{label(cell.service_id, names.services, cell.service_code)} · {label(cell.office_id, names.offices, '')}</h3><Button variant="secondary" size="sm" onClick={() => setCell(null)}>Close</Button></div>
              {!cellData ? <LoadingState className="mt-2" /> : (<>
                <p className="mt-2 font-semibold">Weekly late rate</p>
                <ul className="list-disc pl-5">{cellData.weekly.map((w) => <li key={w.week_start}>Week of {w.week_start}: {w.late_rate}% late ({w.late} of {w.completed})</li>)}</ul>
                <p className="mt-2 font-semibold">Late transactions</p>
                {cellData.late_transactions.length === 0 ? <p>None in this period.</p> : <ul className="list-disc pl-5">{cellData.late_transactions.map((t) => <li key={t.tracking_no}>{t.tracking_no} · {minutesText(t.variance_minutes)} over the limit</li>)}</ul>}
              </>)}
            </div>
          ) : null}
        </section>

        <section aria-label="Charter check" id="insights-charter" className="space-y-3" data-testid="insights-charter">
          <h2 className="title-section">Charter check</h2>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="w-full sm:w-56">
              <label htmlFor="charter-filter" className="label">Show</label>
              <select id="charter-filter" className="input select-chevron" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} data-testid="charter-filter">
                <option value="">All services</option>
                {Object.entries(FLAG_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="w-full sm:w-48">
              <label htmlFor="charter-sort" className="label">Sort by</label>
              <select id="charter-sort" className="input select-chevron" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                <option value="late_rate">Late rate</option><option value="completed">Completed</option><option value="p90_minutes">Time taken</option>
              </select>
            </div>
          </div>
          <DataTable label="Charter check by service" columns={charterCols} data={services_} keyExtractor={(r) => `${r.office_id}-${r.service_id}`} emptyMessage="No services to check in this period." minWidth="46rem" />
          <h3 className="title-card pt-2">Unusual cases</h3>
          <p className="text-xs text-slate-600">Transactions that took far longer than is normal for their service. Shown only for services with at least {data.charter.thresholds.min_completed} completed.</p>
          <DataTable label="Unusual cases" columns={unusualCols} data={data.charter.unusual} keyExtractor={(r) => r.transaction_id} emptyMessage="No unusual cases." minWidth="38rem" />
        </section>

        <section aria-label="Forecast and models" id="insights-models" className="card p-5" data-testid="insights-models">
          <h2 className="title-card">Forecast and models</h2>
          {forecast.state === 'pick' ? <p className="text-sm text-slate-600">Choose an office to see its forecast and late-risk model.</p> : null}
          {forecast.state === 'error' || risk.state === 'error' ? <p className="text-sm text-slate-600">Forecast or late-risk is not available right now.</p> : null}
          {forecast.state === 'ok' && forecast.value?.status === 'SUCCESS' ? <p className="text-sm">Expected this week: <strong>{forecast.value.weeklyTotal}</strong> requests (typical error ±{forecast.value.model?.mae}).</p> : null}
          {forecast.state === 'ok' && forecast.value?.status !== 'SUCCESS' ? <p className="text-sm text-slate-600">The forecast is not ready for this office yet.</p> : null}
          {risk.state === 'ok' && risk.value?.model ? <p className="text-sm">Late-risk model: {risk.value.model.method === 'trained' ? 'trained' : 'rule-based'}{risk.value.model.metrics ? `, accuracy ${Math.round(risk.value.model.metrics.accuracy * 100)}%` : ''}.</p> : null}
        </section>

        <section aria-label="About these numbers" className="card p-5 text-sm" data-testid="insights-about">
          <h2 className="title-card">About these numbers</h2>
          <p>{data.about.completed_rows} completed transactions and {data.about.late_cases} late cases are in the store{data.about.earliest_started_at ? `, from ${formatDateTime(data.about.earliest_started_at)}` : ''}. Updated {formatDateTime(data.generated_at)}.</p>
          {riskModel ? (<>
            <p className="mt-1" data-testid="about-training">Late-risk model: {riskModel.method === 'trained' ? 'trained' : 'rule-based'}{riskModel.trained_at ? ` on ${formatDateTime(riskModel.trained_at)}` : ''}{riskModel.training_rows != null ? `, using ${riskModel.training_rows} transactions (${riskModel.late_cases ?? 0} late)` : ''}.</p>
            {riskModel.metrics ? <p className="mt-1" data-testid="about-metrics">Accuracy {Math.round(riskModel.metrics.accuracy * 100)}%, precision {Math.round(riskModel.metrics.precision * 100)}%, recall {Math.round(riskModel.metrics.recall * 100)}%.</p> : null}
            {riskModel.thresholds ? <p className="mt-1" data-testid="about-thresholds">Risk levels: Medium from {riskModel.thresholds.medium}, High from {riskModel.thresholds.high}.</p> : null}
          </>) : null}
          {fcModel ? <p className="mt-1" data-testid="about-forecast">Forecast model: {fcModel.name}, typical error ±{fcModel.mae} requests a day for this office.</p> : null}
          {isAdmin && modelOffice ? <Button className="mt-3" loading={retraining} loadingLabel="Retraining…" onClick={retrain} data-testid="insights-retrain">Retrain models</Button> : null}
          {disclosure ? <p className="mt-1" data-testid="insights-disclosure">{disclosure}</p> : null}
        </section>
      </>) : null}
    </div>
  );
}
