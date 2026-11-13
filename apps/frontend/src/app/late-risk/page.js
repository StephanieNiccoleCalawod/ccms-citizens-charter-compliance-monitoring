'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import FilterBar from '../../components/forms/FilterBar.js';
import Button from '../../components/ui/Button.js';
import Card from '../../components/ui/Card.js';
import DataTable from '../../components/ui/DataTable.js';
import EmptyState from '../../components/ui/EmptyState.js';
import StatCard from '../../components/ui/StatCard.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { TRANSACTION_PAGE_ROLES } from '../../lib/auth/permissions.js';
import { apiFetch } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const API = '/api/operations/analytics/late-risk';
const percent = (value) => `${Math.round(value * 100)}%`;
const LEVEL_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const LEVEL_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function ModelSummary({ model }) {
  if (!model) return <p className="text-sm text-slate-600">The model details appear once the scores have loaded.</p>;
  return (
    <div className="space-y-2 text-sm text-slate-700">
      <p>
        <StatusBadge variant={model.method === 'trained' ? 'success' : 'neutral'}>{model.method === 'trained' ? 'Trained' : 'Rule-based'}</StatusBadge>
      </p>
      {model.trained_at ? <p>Training time <time dateTime={model.trained_at}>{formatDateTime(model.trained_at)}</time></p> : null}
      {model.rows ? <p>{model.rows.toLocaleString('en-PH')} rows used · {model.late_cases.toLocaleString('en-PH')} late cases in training</p> : null}
      {model.metrics ? <p>Accuracy {percent(model.metrics.accuracy)} · Precision {percent(model.metrics.precision)} · Recall {percent(model.metrics.recall)}</p> : null}
      {model.thresholds ? <p>Medium from {percent(model.thresholds.medium)} · High from {percent(model.thresholds.high)}</p> : null}
      {model.status === 'INSUFFICIENT_DATA' ? <p>Training needs at least 60 late cases in its training set.</p> : null}
      {model.status === 'FAILED' ? <p>The last training attempt failed.</p> : null}
      {model.status === 'STALE' ? <p>The last successful training run is more than seven days old.</p> : null}
    </div>
  );
}

// Sorting is local: the service sends every open transaction of the office at once, highest risk first.
function sortRows(items, sort) {
  if (!sort) return items;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = sort.key === 'risk' ? (row) => (LEVEL_RANK[row.level] ?? 0) * 10 + (row.probability ?? 0) : (row) => row.working_minutes_left;
  return [...items].sort((a, b) => sign * (value(a) - value(b)));
}

function RiskTable({ data, loading, showProbability }) {
  const [sort, setSort] = useState(null);
  const rows = useMemo(() => sortRows(data?.items ?? [], sort), [data, sort]);
  const changeSort = (key) => setSort((current) => (current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'risk' ? 'desc' : 'asc' }));

  const columns = [
    {
      key: 'tracking_no',
      header: 'Tracking number',
      render: (row) =>
        row.can_open ? (
          <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="row-action px-0 font-mono">
            {row.tracking_no}
          </Link>
        ) : (
          <span className="font-mono font-semibold">{row.tracking_no}</span>
        ),
    },
    { key: 'service', header: 'Service', render: (row) => row.service_name },
    {
      key: 'risk',
      header: 'Risk',
      sortable: true,
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusBadge variant={String(row.level).toLowerCase()}>{LEVEL_LABEL[row.level] ?? row.level}</StatusBadge>
          {showProbability && row.probability != null ? <span className="text-slate-600">{percent(row.probability)}</span> : null}
          {row.rule_based ? <span className="text-slate-500">Rule-based</span> : null}
        </span>
      ),
    },
    { key: 'reason', header: 'Reason', className: 'whitespace-normal', render: (row) => <StatusBadge variant="neutral" className="whitespace-normal">{row.reason}</StatusBadge> },
    { key: 'minutes', header: 'Working time left', align: 'right', sortable: true, render: (row) => `${row.working_minutes_left.toLocaleString('en-PH')} min` },
  ];

  return (
    <DataTable
      label="Open transactions, highest risk first"
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.transaction_id}
      loading={loading}
      loadingMessage="Loading scores…"
      emptyMessage="No open transactions in this office."
      minWidth="44rem"
      sort={sort}
      onSortChange={changeSort}
    />
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
  const loading = Boolean(officeId) && !data && !error;
  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return { total: items.length, HIGH: items.filter((i) => i.level === 'HIGH').length, MEDIUM: items.filter((i) => i.level === 'MEDIUM').length, LOW: items.filter((i) => i.level === 'LOW').length };
  }, [data]);
  const shown = (n) => (data ? n.toLocaleString('en-PH') : '-');

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <StatusBanner variant="success" message={notice} onDismiss={() => setNotice('')} dismissAriaLabel="Dismiss message" />

      {campus ? (
        <FilterBar
          label="Late-risk office"
          actions={isAdmin ? <Button onClick={retrain} loading={training} loadingLabel="Training…">Retrain</Button> : null}
        >
          <div className="w-full sm:w-72">
            <label htmlFor="late-risk-office" className="label">Office</label>
            <select id="late-risk-office" value={officeId} onChange={(event) => setOfficeId(event.target.value)} className="input select-chevron">
              <option value="" disabled>Select an office</option>
              {offices.map((office) => <option key={office.office_id} value={office.office_id}>{office.office_name}</option>)}
            </select>
          </div>
        </FilterBar>
      ) : null}

      {!officeId ? (
        <EmptyState role="status">Select an office to see its open transactions ranked by risk.</EmptyState>
      ) : (
        <>
          <section aria-label="Risk summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Open transactions" value={shown(counts.total)} testId="late-risk-open" />
            <StatCard label="High risk" value={shown(counts.HIGH)} tone={counts.HIGH ? 'danger' : 'default'} testId="late-risk-high" />
            <StatCard label="Medium risk" value={shown(counts.MEDIUM)} tone={counts.MEDIUM ? 'warning' : 'default'} testId="late-risk-medium" />
            <StatCard label="Low risk" value={shown(counts.LOW)} testId="late-risk-low" />
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-2">
              {data ? (
                <p className="text-sm text-slate-600">
                  {data.stale ? 'Showing saved scores as of ' : 'Scores as of '}
                  <time dateTime={data.as_of}>{formatDateTime(data.as_of)}</time>
                </p>
              ) : null}
              <RiskTable data={data} loading={loading} showProbability={isAdmin} />
            </div>
            <Card title="Scoring model" description="How the risk levels are worked out.">
              <ModelSummary model={data?.model} />
            </Card>
          </div>
        </>
      )}
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
