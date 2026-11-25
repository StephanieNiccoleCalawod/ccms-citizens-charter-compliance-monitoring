'use client';

import CalculationInfo from '../analytics/CalculationInfo.js';
import Link from 'next/link';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { buildUnusualEmptyState, filterScopedUnusual, minutesText } from '../../lib/ui/insights.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import LoadingState from '../ui/LoadingState.js';

const label = (id, map, fallback) => map?.[id] ?? fallback;

function UnusualEmptyContent({ emptyState }) {
  const { topService, minCompleted } = emptyState;
  return (
    <div
      role="status"
      data-testid="unusual-empty-state"
      data-reason={emptyState.reason}
      className="mx-auto flex max-w-lg flex-col items-center text-center"
    >
      <div
        aria-hidden="true"
        data-testid="unusual-empty-icon"
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-600"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.2 2.3 2.3 4.8-4.8" />
        </svg>
      </div>

      <h3 className="font-sans text-base font-semibold text-[#202938] sm:text-lg" data-testid="unusual-empty-heading">
        No Unusual Delays Found
      </h3>

      <p className="mt-2 font-sans text-xs leading-relaxed text-[#64748B] sm:text-sm" data-testid="unusual-empty-description">
        Transactions that took far longer than is normal for their service are listed here. To keep the results reliable, this is checked only for services with at least{' '}
        <span className="font-semibold text-[#202938]">{minCompleted} completed transactions</span> in the selected period.
      </p>

      <div className="mt-5 flex max-w-full justify-center">
        <div
          data-testid="unusual-empty-badge"
          className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-1.5 font-sans text-xs text-[#64748B]"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-[#64748B]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 9v4M10 6.5h.01" />
          </svg>
          {topService ? (
            <span>
              Highest single-service volume this period:{' '}
              <span className="font-mono font-semibold text-[#202938]">{topService.completed} completed</span>{' '}
              (<span className="font-mono text-[#202938]">{topService.service_code}</span>)
            </span>
          ) : (
            <span>No completed transactions recorded in this period</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Unusual Delays: transactions that took far longer than is normal for their service (elapsed above Q3 + 3 x IQR), preserving RBAC can_open links and rich empty state. */
export default function UnusualCasesPanel({
  overview,
  names = {},
  scope = { kind: 'campus', officeId: null },
  loading = false,
  error = null,
  embedded = false,
}) {
  if (!overview && !loading && !error) return null;

  if (loading && !overview) {
    return (
      <Card id="unusual" as="section" aria-label="Unusual delays" padding="md" className="sm:p-6" data-testid="insights-unusual">
        <LoadingState>Loading unusual delays…</LoadingState>
      </Card>
    );
  }

  if (error) {
    return (
      <Card id="unusual" as="section" aria-label="Unusual delays" padding="md" className="sm:p-6" data-testid="insights-unusual">
        <StatusBanner variant="error" message={error} />
      </Card>
    );
  }

  const unusual = filterScopedUnusual(overview?.charter?.unusual, scope);
  const emptyState = buildUnusualEmptyState({ overview, scope });
  const minCompleted = emptyState.minCompleted;

  const unusualCols = [
    {
      key: 'tracking_no',
      header: 'Transaction',
      render: (r) => (r.can_open
        ? <Link href={`/transactions/${encodeURIComponent(r.transaction_id)}`} className="row-action px-0 font-mono">{r.tracking_no}</Link>
        : <span className="font-mono">{r.tracking_no}</span>),
    },
    { key: 'service', header: 'Service', render: (r) => label(r.service_id, names.services, r.service_code) },
    { key: 'elapsed', header: 'Took', align: 'right', render: (r) => minutesText(r.elapsed_minutes) },
    { key: 'limit', header: 'Charter limit', align: 'right', render: (r) => minutesText(r.limit_minutes) },
    { key: 'ended', header: 'Finished', render: (r) => formatDateTime(r.ended_at) },
  ];

  const description = (
    <>
      Transactions that took far longer than is normal for their service. Checked only for services with at least {minCompleted} completed transactions.
    </>
  );

  if (unusual.length === 0) {
    if (embedded) {
      return (
        <div className="pt-2" data-testid="insights-unusual">
          <div className="rounded-xl border border-[#E2E8F0] bg-white px-6 py-8">
            <UnusualEmptyContent emptyState={emptyState} />
          </div>
        </div>
      );
    }

    return (
      <Card
        id="unusual"
        as="section"
        aria-label="Unusual delays"
        padding="lg"
        className="mx-auto max-w-2xl px-6 py-10 sm:px-12 sm:py-12"
        data-testid="insights-unusual"
      >
        <UnusualEmptyContent emptyState={emptyState} />
      </Card>
    );
  }

  const table = (
    <DataTable
      label="Unusual delays"
      columns={unusualCols}
      data={unusual}
      keyExtractor={(r) => r.transaction_id}
      loading={loading}
      error={error}
      emptyMessage="No unusual delays."
      minWidth="38rem"
    />
  );

  if (embedded) {
    return (
      <div className="pt-2" data-testid="insights-unusual">
        <h4 className="title-card">Unusual Delays</h4>
        <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>
        <div className="mt-2">{table}</div>
      </div>
    );
  }

  return (
    <Card id="unusual" as="section" aria-label="Unusual delays" padding="md" className="space-y-4 sm:p-6" data-testid="insights-unusual">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-2xl font-normal leading-tight text-[#202938]">Unusual Delays</h3>
          <CalculationInfo calculation={overview?.calculations?.charter_summary ?? null} subject="the unusual delays" testId="unusual-calc" />
        </div>
        <p className="mt-1 font-sans text-sm text-[#64748B]">{description}</p>
      </div>
      {table}
    </Card>
  );
}
