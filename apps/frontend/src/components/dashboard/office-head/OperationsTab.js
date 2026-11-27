'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { deriveLateRiskItemMetrics, minutesText } from '../../../lib/ui/insights.js';
import { formatDateTime } from '../../../lib/ui/date-format.js';
import { starterLabels } from '../../../lib/ui/account-position.js';
import { HOME_MESSAGES, tilesFor } from '../../../lib/ui/kpi-home.js';
import DataTable from '../../ui/DataTable.js';
import SearchInput from '../../forms/SearchInput.js';
import StatusBadge from '../../ui/StatusBadge.js';
import NeedsAttentionPanel from './NeedsAttentionPanel.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'overdue', label: 'Late / Overdue' },
  { id: 'high_risk', label: 'High Risk' },
  { id: 'approaching', label: 'Approaching' },
];

const METRIC_INFO = {
  average_time: 'Mean active handling time of transactions completed in the selected period.',
  median_time: 'Median (P50) active handling time - the midpoint, less skewed by outliers than the average.',
  early: 'Transactions completed with time to spare before their Citizen’s Charter deadline.',
  auto_closed: 'Transactions the system closed automatically because the client never claimed the result.',
  cancelled: 'Transactions withdrawn by the client or found invalid before completion.',
  queue_wait: 'Average wait from taking a queue ticket to being served, for transactions started with one.',
};

/** "Time Left" cell: an overdue amount in red, or the remaining time, from the same late-risk item metrics the risk column uses. */
function TimeLeftCell({ risk }) {
  if (!risk) return <span className="td-muted">Not scored</span>;
  if (risk.overdueText) return <span className="td-num font-semibold text-red-700">{risk.overdueText} overdue</span>;
  if (risk.minutesLeft != null) return <span className="td-num font-medium">{minutesText(risk.minutesLeft)} left</span>;
  return <span className="td-muted">-</span>;
}

function RiskPill({ risk }) {
  if (!risk) return <span className="text-xs text-slate-500">Not scored</span>;
  if (risk.overdue) return <StatusBadge variant="danger">High</StatusBadge>;
  if (risk.level === 'HIGH') return <StatusBadge variant="danger">High</StatusBadge>;
  if (risk.level === 'MEDIUM') return <StatusBadge variant="warning">Medium</StatusBadge>;
  return <StatusBadge variant="success">Low</StatusBadge>;
}

function StatusPill({ row, risk }) {
  if (risk?.overdue) return <StatusBadge variant="danger">Overdue</StatusBadge>;
  if (risk?.level === 'HIGH' || risk?.level === 'MEDIUM') return <StatusBadge variant="warning">Due Soon</StatusBadge>;
  return <StatusBadge variant={row.status === 'ON_HOLD' ? 'warning' : 'neutral'}>{row.status === 'ON_HOLD' ? 'Paused' : 'In Progress'}</StatusBadge>;
}

/** Tab 2: Needs Attention + the existing Office Home Pending Transactions table (now filterable/sortable) + Additional Metrics. */
export default function OperationsTab({ officeName, pendingState, pendingPage, pendingPageSize, onPendingPageChange, onPendingPageSizeChange, lateRiskState, totals, loading }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const riskByTransaction = useMemo(() => {
    const map = new Map();
    if (lateRiskState?.state === 'ok') {
      for (const item of lateRiskState.value?.items ?? []) {
        const m = deriveLateRiskItemMetrics(item);
        map.set(item.transaction_id, { level: String(item.level ?? '').toUpperCase(), overdue: m.isOverLimit, overdueText: m.overdueText, minutesLeft: item.working_minutes_left ?? null });
      }
    }
    return map;
  }, [lateRiskState]);

  const matches = useCallback((row, key) => {
    const risk = riskByTransaction.get(row.transaction_id);
    if (key === 'overdue') return Boolean(risk?.overdue);
    if (key === 'high_risk') return Boolean(risk && !risk.overdue && risk.level === 'HIGH');
    if (key === 'approaching') return Boolean(risk && !risk.overdue && risk.level === 'MEDIUM');
    return true;
  }, [riskByTransaction]);

  const counts = useMemo(() => ({
    all: pendingState.items.length,
    overdue: pendingState.items.filter((r) => matches(r, 'overdue')).length,
    high_risk: pendingState.items.filter((r) => matches(r, 'high_risk')).length,
    approaching: pendingState.items.filter((r) => matches(r, 'approaching')).length,
  }), [pendingState.items, matches]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = pendingState.items.filter((r) => (filter === 'all' || filter === 'oldest' ? true : matches(r, filter)));
    if (q) rows = rows.filter((r) => String(r.tracking_no ?? '').toLowerCase().includes(q) || String(r.service_name ?? '').toLowerCase().includes(q));
    if (filter !== 'oldest' && filter !== 'all') {
      rows = [...rows].sort((a, b) => Number(riskByTransaction.get(b.transaction_id)?.overdue || 0) - Number(riskByTransaction.get(a.transaction_id)?.overdue || 0));
    }
    return rows;
  }, [pendingState.items, filter, query, riskByTransaction, matches]);

  const pendingColumns = [
    {
      key: 'tracking_no',
      header: 'Tracking Number',
      render: (row) => (
        <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="row-action px-0 tabular-nums">
          {row.tracking_no}
        </Link>
      ),
    },
    { key: 'service', header: "Citizen's Charter Service", render: (row) => <span className="td-medium">{row.service_name || row.service_code || HOME_MESSAGES.notAvailable}</span> },
    {
      key: 'staff',
      header: 'Assigned Staff',
      render: (row) => {
        const starter = starterLabels(row);
        return (
          <div className="whitespace-normal">
            <span className="block td-medium">{starter.name}</span>
            {starter.position !== '-' ? <span className="td-secondary">{starter.position}</span> : null}
          </div>
        );
      },
    },
    { key: 'started_at', header: 'Started', className: 'tabular-nums', render: (row) => formatDateTime(row.started_at) },
    { key: 'time_left', header: 'Time Left', align: 'right', render: (row) => <TimeLeftCell risk={riskByTransaction.get(row.transaction_id)} /> },
    { key: 'risk', header: 'Risk Level', render: (row) => <RiskPill risk={riskByTransaction.get(row.transaction_id)} /> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill row={row} risk={riskByTransaction.get(row.transaction_id)} /> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="row-action">
          Inspect
        </Link>
      ),
    },
  ];

  const additionalTiles = useMemo(() => {
    const byKey = Object.fromEntries(tilesFor(totals).map((t) => [t.key, t]));
    return ['average_time', 'median_time', 'early', 'auto_closed', 'cancelled', 'queue_wait'].map((key) => byKey[key]).filter(Boolean);
  }, [totals]);

  return (
    <div className="space-y-4" data-testid="office-head-operations">
      <NeedsAttentionPanel
        lateRiskState={lateRiskState}
        oldestPending={pendingState.items}
        onFilterChange={setFilter}
        onSortChange={setFilter}
      />

      <section aria-labelledby="office-head-pending-heading" className="card space-y-4 p-5 sm:p-6" data-testid="office-head-pending" id="office-head-pending">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="office-head-pending-heading" className="title-card">Active Pending Transactions</h2>
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">Showing prioritized queue within {officeName}.</p>
          </div>
          <div className="w-full sm:w-64">
            <SearchInput customPlaceholder="Search tracking # or service…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pending transactions" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter pending transactions">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              data-testid={`pending-filter-${f.id}`}
              className={`cursor-pointer rounded-full border px-3 py-1.5 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon ${
                filter === f.id
                  ? 'border-pup-maroon bg-pup-maroon text-white'
                  : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`}
            >
              {f.label}{f.id !== 'all' && f.id !== 'oldest' ? ` (${counts[f.id]})` : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Filters and risk-based sorting apply to the transactions loaded on this page.</p>

        <DataTable
          label="Pending transactions"
          columns={pendingColumns}
          data={visible}
          keyExtractor={(row) => row.transaction_id}
          loading={pendingState.loading && pendingState.items.length === 0}
          loadingMessage="Loading pending transactions…"
          error={pendingState.error}
          emptyVariant={pendingState.total === 0 && filter === 'all' && !query.trim() ? 'success' : 'search'}
          emptyTitle={pendingState.total === 0 && filter === 'all' && !query.trim() ? 'No Open Transactions' : 'No Matching Transactions Found'}
          emptyMessage={
            pendingState.total === 0 && filter === 'all' && !query.trim()
              ? 'There are currently no open transactions requiring monitoring in your office.'
              : 'No pending transactions match your current search or filter selection.'
          }
          emptyActionLabel={filter !== 'all' || query.trim() ? 'Clear Filters' : undefined}
          onEmptyAction={filter !== 'all' || query.trim() ? () => { setFilter('all'); setQuery(''); } : undefined}
          totalCount={pendingState.loading && pendingState.items.length === 0 ? null : pendingState.total}
          countLabel="pending"
          pagination={{
            page: pendingPage,
            pageSize: pendingPageSize,
            total: pendingState.total,
            loading: pendingState.loading,
            onPage: onPendingPageChange,
            onPageSizeChange: (size) => onPendingPageSizeChange(size),
          }}
          minWidth="48rem"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-muted">
          <span>Showing {visible.length.toLocaleString('en-PH')} matching priority record{visible.length === 1 ? '' : 's'}</span>
          <Link href="/transactions" className="font-semibold text-pup-maroon hover:underline">
            View All {pendingState.total.toLocaleString('en-PH')} Transactions &rarr;
          </Link>
        </div>
      </section>

      <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="office-head-metrics-heading" data-testid="office-head-additional-metrics">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="office-head-metrics-heading" className="title-card">Additional Operational Metrics</h2>
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">Period-based turnaround efficiency &amp; disposition breakdown (hover an info icon for definitions).</p>
          </div>
          <span className="inline-flex items-center rounded-full border border-line bg-surface-muted px-2.5 py-1 font-sans text-xs font-semibold text-ink-muted">
            Selected Reporting Period
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-busy={loading}>
          {additionalTiles.map((tile) => (
            <div key={tile.key} className="flex flex-col justify-between gap-1 rounded-xl border border-line bg-surface-muted/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{tile.label}</p>
                {METRIC_INFO[tile.key] ? (
                  <span
                    title={METRIC_INFO[tile.key]}
                    aria-label={METRIC_INFO[tile.key]}
                    className="inline-flex shrink-0 cursor-help text-ink-muted/70 transition-colors hover:text-ink"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="10" cy="10" r="8" />
                      <path d="M10 9v4M10 6.5h.01" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <p className="font-sans text-xl font-bold leading-tight tabular-nums text-ink">{loading && !totals ? '-' : tile.value}</p>
              {tile.note ? <p className="text-xs text-ink-muted">{tile.note}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
