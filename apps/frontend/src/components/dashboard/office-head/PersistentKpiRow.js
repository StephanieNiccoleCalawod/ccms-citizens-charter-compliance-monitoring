'use client';

import Link from 'next/link';
import StatCard from '../../ui/StatCard.js';
import { tilesFor } from '../../../lib/ui/kpi-home.js';

/**
 * The four mandatory operational KPI cards (always visible, above the tabs, on every tab): Received, Completed,
 * Pending Now, Late. Read from the same `tilesFor()` totals bucket Office Home has always used - one calculation,
 * no second source of truth. Received and Completed are scoped to the selected reporting period; Pending Now is
 * the office's current open count (tilesFor's `pending` key is already period-independent); Late preserves Office
 * Home's existing definition (completed late within the selected period - see `onJumpToPending`/the Needs
 * Attention panel for *currently open* overdue transactions, a different, current-time figure).
 */
export default function PersistentKpiRow({ totals, loading, periodLabel, onJumpToPending }) {
  const byKey = Object.fromEntries(tilesFor(totals).map((t) => [t.key, t]));
  const show = (key) => {
    if (loading && !totals) return '-';
    const raw = byKey[key]?.value ?? 0;
    return Number.isFinite(Number(raw)) ? Number(raw).toLocaleString('en-PH') : String(raw);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="office-head-kpi-row" aria-busy={loading}>
      <StatCard
        testId="ohd-kpi-received"
        label="Received"
        value={show('received')}
        note={periodLabel || 'Selected period'}
        className="h-full justify-between p-5"
      />
      <StatCard
        testId="ohd-kpi-completed"
        label="Completed"
        value={show('completed')}
        note={periodLabel || 'Selected period'}
        className="h-full justify-between p-5"
      />
      <StatCard
        testId="ohd-kpi-pending"
        label="Pending Now"
        value={show('pending')}
        note="Current open workload"
        className="h-full justify-between p-5"
      >
        {byKey.pending?.note ? <p className="text-xs text-ink-muted">{byKey.pending.note}</p> : null}
        <button
          type="button"
          onClick={onJumpToPending}
          className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded text-left text-xs font-semibold text-pup-maroon hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
        >
          View pending transactions &rarr;
        </button>
      </StatCard>
      <StatCard
        testId="ohd-kpi-late"
        label="Late"
        value={show('late')}
        tone="danger"
        note={`Completed late · ${periodLabel || 'selected period'}`}
        className="h-full justify-between p-5"
      >
        <Link
          href="/late-risk"
          className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-pup-maroon hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
        >
          View currently overdue transactions &rarr;
        </Link>
      </StatCard>
    </div>
  );
}
