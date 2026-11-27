'use client';

import { deriveLateRiskItemMetrics } from '../../../lib/ui/insights.js';

/**
 * Compact operational alert strip (Operations tab, "Needs Attention"). Built only from data the dashboard already
 * fetches - the same late-risk items behind Deadline Risk Monitoring (lib/api/analytics.js dashboardLateRisk) and
 * the same oldest-first pending list Office Home has always shown (getOfficePendingTransactions). Each alert is a
 * disjoint slice (an item counts as Overdue OR High Risk OR Approaching Deadline, never more than one) so nothing
 * is counted twice in a misleading way. "Filter"/"Sort" apply the matching filter to the Pending Transactions table
 * below via onFilterChange/onSortChange, so the alerts are a shortcut into that table, not a separate claim.
 */
export default function NeedsAttentionPanel({ lateRiskState, oldestPending, onFilterChange, onSortChange }) {
  const items = lateRiskState?.state === 'ok' ? (lateRiskState.value?.items ?? []) : [];
  const metrics = items.map((item) => ({ item, m: deriveLateRiskItemMetrics(item) }));
  const overdue = metrics.filter(({ m }) => m.isOverLimit);
  const approaching = metrics.filter(({ item, m }) => !m.isOverLimit && String(item.level).toUpperCase() === 'MEDIUM');
  const highRisk = metrics.filter(({ item, m }) => !m.isOverLimit && String(item.level).toUpperCase() === 'HIGH');
  const total = items.length;

  // The deployed model's own high-risk threshold, when known, instead of a made-up percentage.
  const highThresholdPct = lateRiskState?.value?.model?.thresholds?.high != null
    ? Math.round(Number(lateRiskState.value.model.thresholds.high) * 100)
    : null;

  const oldest = oldestPending?.[0] ?? null;
  const oldestAge = oldest?.started_at ? ageText(oldest.started_at) : null;

  if (lateRiskState?.state === 'error') {
    return (
      <section className="card p-5" data-testid="office-head-needs-attention">
        <p className="text-sm text-ink-muted">{lateRiskState.message || 'Deadline risk is unavailable right now.'}</p>
      </section>
    );
  }

  return (
    <section className="card p-5" aria-labelledby="needs-attention-heading" data-testid="office-head-needs-attention">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="needs-attention-heading" className="title-card">Needs Attention</h2>
            <span className="inline-flex items-center rounded-full border border-line bg-surface-muted px-2 py-0.5 font-sans text-[11px] font-semibold tabular-nums text-ink-muted">
              {total.toLocaleString('en-PH')} Open
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted sm:text-sm">
            Active workload alerts deduplicated across open transactions in your office.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AlertCard
          tone="danger"
          label="Overdue Open"
          count={overdue.length}
          note="Past SLA deadline"
          actionLabel="Filter"
          onAction={() => onFilterChange('overdue')}
        />
        <AlertCard
          tone="warning"
          label="Approaching Deadline (<4h)"
          count={approaching.length}
          note="Due today"
          actionLabel="Filter"
          onAction={() => onFilterChange('approaching')}
        />
        <AlertCard
          tone="danger"
          label="High-Risk Open"
          count={highRisk.length}
          note={highThresholdPct !== null ? `>${highThresholdPct}% breach probability` : 'Likely to miss the deadline'}
          actionLabel="Filter"
          onAction={() => onFilterChange('high_risk')}
        />
        <AlertCard
          tone="neutral"
          label="Oldest Pending Item"
          count={oldestAge ?? '-'}
          note={oldest?.tracking_no ?? 'No pending transactions'}
          actionLabel="Sort"
          onAction={() => onSortChange('oldest')}
        />
      </div>
    </section>
  );
}

const TONE = {
  danger: { activeCard: 'border-[#F3C5C5] bg-[#FDF2F2]/75', activeLabel: 'text-[#800000]', activeCount: 'text-[#800000]' },
  warning: { activeCard: 'border-[#F0DDB0] bg-[#FFFBEB]', activeLabel: 'text-[#78350F]', activeCount: 'text-[#78350F]' },
  neutral: { activeCard: 'border-line bg-surface-muted/60', activeLabel: 'text-ink-muted', activeCount: 'text-ink' },
};

function AlertCard({ tone, label, count, note, actionLabel, onAction }) {
  const active = typeof count === 'number' && count > 0;
  const palette = TONE[tone] ?? TONE.neutral;
  const cardTone = active ? palette.activeCard : 'border-line bg-surface-muted/60';
  const labelTone = active ? palette.activeLabel : 'text-ink-muted';
  const countTone = active ? palette.activeCount : 'text-ink';
  return (
    <div
      className={`flex flex-col justify-between gap-2 rounded-xl border p-4 ${cardTone}`}
      data-testid={`alert-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`font-sans text-xs font-semibold uppercase tracking-wide ${labelTone}`}>{label}</span>
        <button type="button" onClick={onAction} className="row-action -mr-1.5 -mt-1 shrink-0">
          {actionLabel} &rarr;
        </button>
      </div>
      <div>
        <p className={`font-sans text-2xl font-bold leading-tight tabular-nums ${countTone}`}>{count}</p>
        <p className="mt-1 truncate font-sans text-xs text-ink-muted">{note}</p>
      </div>
    </div>
  );
}

/** "6d 4h" since the given ISO time, for the oldest pending item. */
function ageText(iso) {
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - start) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}
