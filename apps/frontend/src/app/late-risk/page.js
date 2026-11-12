'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { TRANSACTION_PAGE_ROLES } from '../../lib/auth/permissions.js';
import { apiFetch } from '../../lib/auth/session.js';

const API = '/api/operations/analytics/late-risk';
const formatTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const percent = (value) => `${Math.round(value * 100)}%`;
const tones = { HIGH: 'bg-red-100 text-red-900', MEDIUM: 'bg-amber-100 text-amber-900', LOW: 'bg-green-100 text-green-900' };
const labels = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

function ModelSummary({ model }) {
  if (!model) return null;
  return (
    <div className="space-y-2 text-sm text-slate-700">
      <p className="font-semibold text-slate-900">{model.method === 'trained' ? 'Trained' : 'Rule-based'}</p>
      {model.trained_at ? <p>Training time <time dateTime={model.trained_at}>{formatTime.format(new Date(model.trained_at))}</time></p> : null}
      {model.rows ? <p>{model.rows.toLocaleString('en-PH')} rows used · {model.late_cases.toLocaleString('en-PH')} late cases in training</p> : null}
      {model.metrics ? <p>Accuracy {percent(model.metrics.accuracy)} · Precision {percent(model.metrics.precision)} · Recall {percent(model.metrics.recall)}</p> : null}
      {model.thresholds ? <p>Medium from {percent(model.thresholds.medium)} · High from {percent(model.thresholds.high)}</p> : null}
      {model.status === 'INSUFFICIENT_DATA' ? <p>Training needs at least 60 late cases in its training set.</p> : null}
      {model.status === 'FAILED' ? <p>The last training attempt failed.</p> : null}
      {model.status === 'STALE' ? <p>The last successful training run is more than seven days old.</p> : null}
    </div>
  );
}

function RiskRows({ data, showProbability }) {
  if (!data) return null;
  if (data.items.length === 0) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No open transactions in this office.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <caption className="sr-only">Open transactions, highest risk first</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
          <tr>
            <th scope="col" className="px-4 py-3">Tracking number</th>
            <th scope="col" className="px-4 py-3">Service</th>
            <th scope="col" className="px-4 py-3">Risk</th>
            <th scope="col" className="px-4 py-3">Reason</th>
            <th scope="col" className="px-4 py-3">Working time left</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((row) => (
            <tr key={row.transaction_id}>
              <td className="whitespace-nowrap px-4 py-3 font-semibold">
                {row.can_open ? <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="text-maroon-900 underline underline-offset-2">{row.tracking_no}</Link> : row.tracking_no}
              </td>
              <td className="px-4 py-3">{row.service_name}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <span className={`rounded-full px-2 py-1 font-medium ${tones[row.level]}`}>{labels[row.level]}</span>
                {showProbability && row.probability != null ? <span className="ml-2 text-slate-600">{percent(row.probability)}</span> : null}
                {row.rule_based ? <span className="ml-2 text-xs text-slate-600">Rule-based</span> : null}
              </td>
              <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">{row.reason}</span></td>
              <td className="whitespace-nowrap px-4 py-3">{row.working_minutes_left.toLocaleString('en-PH')} min</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LateRisk({ user }) {
  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  const campus = isAdmin || user.role === ROLES.EXECUTIVE;
  const [offices, setOffices] = useState([]);
  const [officeId, setOfficeId] = useState(user.officeId ?? '');
  const [scores, setScores] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [training, setTraining] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!campus) return undefined;
    let active = true;
    apiFetch(OFFICES_API).then(({ items }) => {
      if (!active) return;
      const available = (items ?? []).filter((office) => office.is_active !== false);
      setOffices(available);
      setOfficeId((current) => current || available[0]?.office_id || '');
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [campus]);

  useEffect(() => {
    if (!officeId) return undefined;
    let active = true;
    const url = `${API}?officeId=${encodeURIComponent(officeId)}`;
    const refresh = () => apiFetch(url).then((data) => {
      if (active) { setScores({ officeId, data }); setError(''); }
    }).catch((failure) => { if (active) setError(failure.message); });
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [officeId, revision]);

  async function retrain() {
    setTraining(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch(`${API}/retrain`, { method: 'POST' });
      setNotice(result.running ? 'Training is already running.' : result.model.method === 'trained' ? 'Training completed.' : 'Training finished with rule-based scoring.');
      setRevision((current) => current + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setTraining(false);
    }
  }

  const data = scores?.officeId === officeId ? scores.data : null;
  return (
    <div className="space-y-5">
      {error ? <ErrorBanner message={error} /> : null}
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5" aria-label="Late-risk model">
        <div className="space-y-3">
          {campus ? (
            <label className="block text-sm font-semibold text-slate-700">
              Office
              <select value={officeId} onChange={(event) => setOfficeId(event.target.value)} className="input mt-1 block min-w-60">
                <option value="" disabled>Select an office</option>
                {offices.map((office) => <option key={office.office_id} value={office.office_id}>{office.office_name}</option>)}
              </select>
            </label>
          ) : null}
          <ModelSummary model={data?.model} />
        </div>
        {isAdmin ? <button type="button" onClick={retrain} disabled={training} className="rounded-lg bg-maroon-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{training ? 'Training…' : 'Retrain'}</button> : null}
        {notice ? <p role="status" className="w-full text-sm text-slate-700">{notice}</p> : null}
      </section>
      {data ? <p className="text-sm text-slate-600">{data.stale ? 'Showing saved scores as of ' : 'Scores as of '}<time dateTime={data.as_of}>{formatTime.format(new Date(data.as_of))}</time></p> : officeId && !error ? <p role="status" className="text-sm text-slate-600">Loading scores…</p> : null}
      <RiskRows data={data} showProbability={isAdmin} />
    </div>
  );
}

export default function LateRiskPage() {
  return (
    <AppShell title="Late-risk" subtitle="Open transactions ranked by risk of missing their deadline." allowedRoles={TRANSACTION_PAGE_ROLES}>
      {(user) => <LateRisk key={user.id} user={user} />}
    </AppShell>
  );
}
