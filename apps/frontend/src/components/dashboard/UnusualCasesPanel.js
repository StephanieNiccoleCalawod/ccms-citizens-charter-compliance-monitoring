'use client';

import CalculationInfo from '../analytics/CalculationInfo.js';
import Link from 'next/link';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { buildUnusualEmptyState, filterScopedUnusual, minutesText } from '../../lib/ui/insights.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import EmptyState from '../ui/EmptyState.js';
import LoadingState from '../ui/LoadingState.js';

const label = (id, map, fallback) => map?.[id] ?? fallback;

function UnusualEmptyContent({ emptyState }) {
  const { topService, minCompleted, reason } = emptyState;
  const isSuccess = reason === 'none_detected';
  const title = isSuccess
    ? 'No Unusual Delays Found'
    : reason === 'insufficient_data'
      ? 'Not Enough Completed Data Yet'
      : 'No Completed Transactions Yet';
  const description = reason === 'no_transactions' ? (
    'Transactions that took far longer than is normal for their service are listed here. No completed transactions were recorded in the selected period.'
  ) : reason === 'insufficient_data' ? (
    <>
      Transactions that took far longer than is normal for their service are listed here. To keep the results reliable, this is checked only for services with at least{' '}
      <span className="font-semibold text-ink">{minCompleted} completed transactions</span> in the selected period.
    </>
  ) : (
    <>
      Transactions that took far longer than is normal for their service are listed here. No unusual delays were detected among services with at least{' '}
      <span className="font-semibold text-ink">{minCompleted} completed transactions</span> in the selected period.
    </>
  );
  const support = topService ? (
    <>
      Highest single-service volume this period:{' '}
      <span className="font-semibold tabular-nums text-ink">{topService.completed} completed</span>{' '}
      (<span className="font-medium tabular-nums text-ink">{topService.service_code}</span>)
    </>
  ) : (
    'No completed transactions recorded in this period'
  );

  return (
    <EmptyState
      role="status"
      surface="plain"
      variant={isSuccess ? 'success' : 'neutral'}
      icon={isSuccess ? 'check' : 'chart'}
      title={title}
      description={description}
      supportingInfo={support}
      data-testid="unusual-empty-state"
      data-reason={reason}
      iconTestId="unusual-empty-icon"
      titleTestId="unusual-empty-heading"
      descriptionTestId="unusual-empty-description"
      supportTestId="unusual-empty-badge"
    />
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
        ? <Link href={`/transactions/${encodeURIComponent(r.transaction_id)}`} className="row-action px-0 tabular-nums">{r.tracking_no}</Link>
        : <span className="td-id">{r.tracking_no}</span>),
    },
    { key: 'service', header: 'Service', render: (r) => <span className="td-medium">{label(r.service_id, names.services, r.service_code)}</span> },
    { key: 'elapsed', header: 'Took', align: 'right', render: (r) => <span className="td-num font-semibold">{minutesText(r.elapsed_minutes)}</span> },
    { key: 'limit', header: 'Charter limit', align: 'right', className: 'tabular-nums', render: (r) => minutesText(r.limit_minutes) },
    { key: 'ended', header: 'Finished', className: 'tabular-nums', render: (r) => formatDateTime(r.ended_at) },
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
