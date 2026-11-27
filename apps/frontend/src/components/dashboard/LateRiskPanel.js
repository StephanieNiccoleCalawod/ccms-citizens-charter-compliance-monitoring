'use client';

import Link from 'next/link';
import { formatDateTime } from '../../lib/ui/date-format.js';
import ChartCard from '../charts/ChartCard.js';
import StatusBanner from '../feedback/StatusBanner.js';

const n = (value) => Number(value || 0).toLocaleString('en-PH');

const CARD_TONE = Object.freeze({
  low: {
    card: 'border-emerald-200 bg-emerald-50/50',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    title: 'text-emerald-800',
    count: 'text-[#202938]',
  },
  medium: {
    card: 'border-[#E2E8F0] bg-[#F8FAFC]',
    dot: 'bg-amber-400',
    bar: 'bg-amber-400',
    title: 'text-[#202938]',
    count: 'text-[#202938]',
  },
  high: {
    card: 'border-[#F3C5C5] bg-[#FDF2F2]/75',
    dot: 'bg-rose-500',
    bar: 'bg-rose-600',
    title: 'text-[#800000]',
    count: 'text-[#800000]',
  },
});

const FALLBACK_TONE = Object.freeze({
  card: 'border-[#F3C5C5] bg-[#F8EEEE]',
  dot: 'bg-[#800000]',
  bar: 'bg-[#800000]',
  title: 'text-[#4A0808]',
  count: 'text-[#800000]',
});

/** Section 4, left: open transactions grouped by deadline proximity with stacked distribution bar and summary cards. */
export default function LateRiskPanel({ lateRisk, loading = false, actionHref = '/late-risk' }) {
  const { categories = [], total = 0, state = 'ok', message = '', stale = false, asOf = null, officeName = '' } = lateRisk ?? {};

  const description = state === 'pick' ? (
    'Choose an office above to see which open transactions are at risk of missing their deadline.'
  ) : (
    <>
      {officeName ? (
        <>
          <span className="font-semibold text-[#202938]">{officeName}</span> &mdash;{' '}
        </>
      ) : null}
      <span className="font-bold text-[#202938]">{n(total)}</span> open transaction{total === 1 ? '' : 's'} grouped by how close {total === 1 ? 'it is' : 'they are'} to the deadline.
    </>
  );

  return (
    <ChartCard
      id="risk"
      title="Deadline Risk Summary"
      badge={state === 'ok' ? (
        <span className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-mono text-[10px] font-bold text-[#64748B]">
          {n(total)} Active
        </span>
      ) : null}
      headerRight={actionHref ? (
        <Link href={actionHref} className="font-sans text-xs font-semibold text-[#800000] hover:underline">
          Chance of Finishing Late &rarr;
        </Link>
      ) : null}
      calculation={lateRisk?.calculation ?? null}
      calculationSubject="the deadline risk"
      description={description}
      empty={state === 'ok' && !loading && categories.length === 0}
      emptyVariant="success"
      emptyTitle="No Open Transactions"
      emptyMessage="There are currently no open transactions requiring deadline risk monitoring."
      table={state === 'ok' && categories.length > 0 ? {
        caption: 'Open transactions by deadline risk',
        columns: [
          { key: 'label', label: 'Risk' },
          { key: 'count', label: 'Open transactions', align: 'right' },
          { key: 'description', label: 'Meaning' },
        ],
        rows: categories.map((c) => ({ label: c.label, count: n(c.count), description: c.description })),
      } : null}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Deadlines count working days only; holidays and weekends are excluded</span>
          {actionHref ? (
            <Link href={actionHref} className="font-semibold text-[#202938] hover:text-[#800000] hover:underline">
              See full ranked list &rarr;
            </Link>
          ) : null}
        </div>
      )}
    >
      {loading && state !== 'ok' ? (
        <div className="space-y-2" role="status" aria-label="Loading deadline risk">
          <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : state === 'error' ? (
        <StatusBanner variant="error" message={message || 'Deadline risk is unavailable right now.'} />
      ) : state === 'pick' ? (
        <p className="text-sm text-slate-600" data-testid="late-risk-pick-office">Select an office above to see its deadline risk.</p>
      ) : (
        <div data-testid="dashboard-late-risk" className="space-y-4">
          {stale ? (
            <p className="text-xs text-amber-800">
              Showing saved results{asOf ? ` as of ${formatDateTime(asOf)}` : ''}.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <p className="font-sans text-xs font-medium text-[#64748B]">
              Predictive probability of open transactions exceeding SLA
            </p>

            <div
              role="img"
              aria-label={`Stacked bar of open transactions by deadline risk:${categories.map((c) => `${c.label} ${c.count}`).join(', ')}.`}
              data-testid="late-risk-stacked-bar"
              className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-[#E2E8F0]"
            >
              {categories.map((c) => {
                if (!total || c.count <= 0) return null;
                const tone = CARD_TONE[c.key] ?? FALLBACK_TONE;
                const widthPct = Math.max(4, Math.round((c.count / total) * 1000) / 10);
                return (
                  <div
                    key={c.key}
                    style={{ width: `${widthPct}%` }}
                    title={`${c.label} Risk: ${n(c.count)}`}
                    className={`h-full transition-all ${tone.bar}`}
                  />
                );
              })}
            </div>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            {categories.map((c) => {
              const tone = CARD_TONE[c.key] ?? FALLBACK_TONE;
              const pct = total > 0 ? Math.round((c.count / total) * 1000) / 10 : 0;
              return (
                <li
                  key={c.key}
                  data-testid={`late-risk-card-${c.key}`}
                  className={`flex flex-col justify-between rounded-xl border p-3.5 ${tone.card}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 font-sans text-xs font-bold ${tone.title}`}>
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                      <span>{c.label} Risk</span>
                    </span>
                    <span className="text-right">
                      <span className={`block font-mono text-xl font-bold tabular-nums ${tone.count}`}>
                        {pct}%
                      </span>
                      <span className="block font-sans text-[11px] text-[#64748B]">{n(c.count)} txns</span>
                    </span>
                    <span className="sr-only">{c.label}: {pct}%, {n(c.count)} transactions</span>
                  </div>
                  {c.description ? (
                    <p className="mt-2 font-sans text-xs leading-relaxed text-[#64748B]">
                      {c.description}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
