'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Modal from '../modals/Modal.js';
import SearchInput from '../forms/SearchInput.js';
import Button from '../ui/Button.js';
import DataTable from '../ui/DataTable.js';
import EmptyState from '../ui/EmptyState.js';
import IconButton from '../ui/IconButton.js';
import StatusBadge from '../ui/StatusBadge.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import {
  buildLateRiskMilestones,
  deriveLateRiskItemMetrics,
  minutesText,
} from '../../lib/ui/insights.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';

const API = '/api/operations/analytics/late-risk';
const percent = (value) => `${Math.round(Number(value) * 100)}%`;
const LEVEL_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const LEVEL_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function LateRiskModelSummary({ model }) {
  if (!model) {
    return (
      <p className="text-sm text-[#64748B]" data-testid="late-risk-model-summary">
        The model details appear once the scores have loaded.
      </p>
    );
  }

  const medPct = model.thresholds ? Math.round(Number(model.thresholds.medium) * 100) : null;
  const highPct = model.thresholds ? Math.round(Number(model.thresholds.high) * 100) : null;
  const lowRecall = model.metrics && Number(model.metrics.recall) < 0.5;

  return (
    <div className="space-y-4 text-xs text-[#202938]" data-testid="late-risk-model-summary">
      {/* B. Training Information */}
      <div className="space-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
        {model.trained_at ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-sans text-[#64748B]">Last trained</span>
            <span className="font-mono font-semibold text-[#202938]">
              <span className="sr-only">Training time </span>
              <time dateTime={model.trained_at}>{formatDateTime(model.trained_at)}</time>
            </span>
          </div>
        ) : null}
        {model.rows ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-sans text-[#64748B]">Training corpus</span>
            <span className="font-mono font-semibold text-[#202938]">
              {model.rows.toLocaleString('en-PH')} rows<span className="sr-only"> used</span> &middot; {model.late_cases.toLocaleString('en-PH')} late cases<span className="sr-only"> in training</span>
            </span>
          </div>
        ) : null}
        {!model.trained_at && !model.rows ? (
          <p className="font-sans text-[#64748B]">
            Using rule-based Citizen&rsquo;s Charter time-limit thresholds.
          </p>
        ) : null}
      </div>

      {/* C. Model Health Diagnostics */}
      {model.metrics ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
              Model Health Diagnostics
            </span>
            <span className="font-sans text-[11px] text-[#64748B]">Validation set</span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between font-sans text-xs">
              <span className="font-medium text-[#202938]">Accuracy</span>
              <span className="font-mono font-bold text-[#202938]">{percent(model.metrics.accuracy)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(4, Math.min(100, Math.round(Number(model.metrics.accuracy) * 100)))}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between font-sans text-xs">
              <span className="font-medium text-[#202938]">Precision</span>
              <span className="font-mono font-bold text-[#202938]">{percent(model.metrics.precision)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${Math.max(4, Math.min(100, Math.round(Number(model.metrics.precision) * 100)))}%` }}
              />
            </div>
          </div>

          <div className={lowRecall ? 'space-y-1.5 rounded-xl border border-[#F0DDB0] bg-[#FFFBEB] p-3' : 'space-y-1'}>
            <div className="flex items-center justify-between font-sans text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#202938]">
                <span>Recall</span>
                {lowRecall ? (
                  <span className="rounded bg-[#FEF3C7] px-1.5 py-0.2 text-[10px] font-bold text-[#92400E]">
                    Low
                  </span>
                ) : null}
              </span>
              <span className="font-mono font-bold text-[#202938]">{percent(model.metrics.recall)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className={`h-full rounded-full ${lowRecall ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max(4, Math.min(100, Math.round(Number(model.metrics.recall) * 100)))}%` }}
              />
            </div>
            {lowRecall ? (
              <p className="pt-0.5 font-sans text-[11px] leading-relaxed text-[#78350F]">
                Conservative flagging: only high-confidence delays trigger alerts, so some borderline transactions may not be flagged early.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* D. Risk Score Thresholds */}
      {model.thresholds ? (
        <div className="space-y-2.5">
          <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
            Risk Score Thresholds
          </span>
          <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-[#E2E8F0]">
            <div className="h-full flex-1 bg-emerald-500" />
            <div className="h-full flex-1 bg-amber-400" />
            <div className="h-full flex-1 bg-rose-600" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-2">
              <span className="block font-sans text-xs font-bold text-emerald-800">Low</span>
              <span className="mt-0.5 block font-mono text-[11px] text-emerald-700">&lt; {medPct}%</span>
            </div>
            <div className="rounded-lg border border-[#F0DDB0] bg-[#FFFBEB] px-2 py-2">
              <span className="block font-sans text-xs font-bold text-[#78350F]">Medium</span>
              <span className="mt-0.5 block font-mono text-[11px] text-[#92400E]">
                {medPct}%&ndash;{Math.max(medPct, highPct - 1)}%
              </span>
              <span className="sr-only">Medium from {percent(model.thresholds.medium)}</span>
            </div>
            <div className="rounded-lg border border-[#F3C5C5] bg-[#FDF2F2] px-2 py-2">
              <span className="block font-sans text-xs font-bold text-[#800000]">High</span>
              <span className="mt-0.5 block font-mono text-[11px] text-[#800000]">&ge; {highPct}%</span>
              <span className="sr-only">High from {percent(model.thresholds.high)}</span>
            </div>
          </div>
        </div>
      ) : null}

      {model.status === 'INSUFFICIENT_DATA' ? <p className="text-[#64748B]">Training needs at least 60 late cases in its training set.</p> : null}
      {model.status === 'FAILED' ? <p className="text-rose-700">The last training attempt failed.</p> : null}
      {model.status === 'STALE' ? <p className="text-amber-800">The last successful training run is more than seven days old.</p> : null}
    </div>
  );
}

// Sorting is local: the service sends every open transaction of the office at once, highest risk first.
function sortRows(items, sort) {
  if (!sort) return items;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = sort.key === 'risk'
    ? (row) => (LEVEL_RANK[row.level] ?? 0) * 10 + (row.probability ?? 0)
    : sort.key === 'consumed'
      ? (row) => deriveLateRiskItemMetrics(row).share ?? -1
      : sort.key === 'tracking_no'
        ? (row) => String(row.tracking_no ?? '')
        : (row) => Number(row.working_minutes_left) || 0;

  return [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'string' || typeof vb === 'string') {
      return sign * String(va).localeCompare(String(vb));
    }
    return sign * (va - vb);
  });
}

function RiskScorePill({ row, showProbability }) {
  const lvl = String(row?.level ?? '').toUpperCase();
  const prob = showProbability && row?.probability != null ? ` ${percent(row.probability)}` : '';
  const style = lvl === 'HIGH'
    ? { pill: 'border-[#F3C5C5] bg-[#FDF2F2] text-[#800000]', dot: 'bg-rose-600' }
    : lvl === 'MEDIUM'
      ? { pill: 'border-[#F0DDB0] bg-[#FEF3C7] text-[#78350F]', dot: 'bg-amber-500' }
      : { pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-sans text-xs font-bold tabular-nums ${style.pill}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        <span>{LEVEL_LABEL[lvl] ?? lvl}{prob}</span>
      </span>
      {row.rule_based ? <span className="text-[11px] text-[#64748B]">Rule-based</span> : null}
    </span>
  );
}

/**
 * Centered modal dialog for Escalate (high-risk / overdue) and Inspect (within time limit / review) actions.
 * Uses the shared CCCMS <Modal> component to display Detail Header, Citizen's Charter Service card,
 * Time Limit Used card, Processing Milestones timeline, and confirmation-gated Escalate / transaction detail actions.
 */
export function LateRiskDetailDrawer({
  item,
  mode = 'inspect',
  officeName = '',
  asOf = null,
  showProbability = false,
  isExecutive = false,
  onClose,
  onEscalateConfirmed,
}) {
  const router = useRouter();
  const [confirmEscalate, setConfirmEscalate] = useState(false);

  if (!item) return null;

  const m = deriveLateRiskItemMetrics(item);
  const lvl = String(item.level ?? '').toUpperCase();
  const isOverdueOrHigh = m.isOverLimit || lvl === 'HIGH';
  const isEscalateMode = mode === 'escalate' || isOverdueOrHigh;
  const probText = showProbability && item.probability != null ? ` ${percent(item.probability)}` : '';

  const badgeTone = lvl === 'HIGH'
    ? 'border-[#F3C5C5] bg-[#FDF2F2] text-[#800000]'
    : lvl === 'MEDIUM'
      ? 'border-[#F0DDB0] bg-[#FEF3C7] text-[#78350F]'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  const formattedStart = item.started_at ? formatDateTime(item.started_at) : '';
  const formattedAsOf = asOf ? formatDateTime(asOf) : '';
  const milestones = buildLateRiskMilestones(item, { formattedStart, formattedAsOf });

  const processorLabel = isExecutive
    ? 'Protected (Executive view)'
    : item.started_by_name
      ? (item.started_by_position ? `${item.started_by_name} (${item.started_by_position})` : item.started_by_name)
      : 'Assigned Office Staff';

  const submittedLabel = formattedStart || formattedAsOf || 'Recorded in queue';
  const minsLeft = Math.max(0, Number(item.working_minutes_left ?? 0));

  return (
    <>
      <Modal
        open={Boolean(item)}
        title={item.tracking_no}
        onClose={onClose}
        widthClass="max-w-lg"
        hideHeader
        flushBody
      >
        <div
          data-testid="late-risk-detail-drawer"
          data-mode={isEscalateMode ? 'escalate' : 'inspect'}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* 1. Detail Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="late-risk-drawer-badge"
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 font-sans text-xs font-bold tabular-nums ${badgeTone}`}
                >
                  {LEVEL_LABEL[lvl] ?? lvl}{probText}
                </span>
                {officeName ? (
                  <span className="truncate font-sans text-xs font-medium text-[#64748B]">
                    {officeName}
                  </span>
                ) : null}
              </div>
              <p
                id="late-risk-drawer-title"
                data-testid="late-risk-drawer-tracking"
                className="mt-1.5 font-mono text-lg font-bold text-[#202938]"
              >
                {item.tracking_no}
              </p>
            </div>

            <IconButton
              onClick={onClose}
              label="Close transaction details"
              data-testid="late-risk-drawer-close"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </IconButton>
          </div>

          {/* Scrollable Body */}
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {/* 2. Citizen's Charter Service Card */}
            <section
              aria-label="Citizen's Charter service"
              data-testid="late-risk-drawer-service"
              className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4"
            >
              <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                Citizen&rsquo;s Charter Service
              </span>
              <p className="mt-1 font-sans text-sm font-bold leading-snug text-[#202938]">
                {item.service_name}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#E2E8F0] pt-3 text-xs">
                <div>
                  <span className="block font-sans text-[11px] text-[#64748B]">Assigned Processor</span>
                  <span className="mt-0.5 block font-sans font-semibold text-[#202938]">{processorLabel}</span>
                </div>
                <div>
                  <span className="block font-sans text-[11px] text-[#64748B]">Submitted</span>
                  <span className="mt-0.5 block font-mono font-semibold text-[#202938]">{submittedLabel}</span>
                </div>
              </div>
            </section>

            {/* 3. Time Limit Used Card */}
            <section
              aria-label="Time limit used"
              data-testid="late-risk-drawer-sla"
              className={`rounded-xl border p-4 ${isOverdueOrHigh
                ? 'border-[#F3C5C5] bg-[#FDF2F2]/75'
                : 'border-[#E2E8F0] bg-white'
                }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-sans text-xs">
                <span className="font-bold text-[#202938]">Time Limit Used</span>
                <span
                  data-testid="late-risk-drawer-consumption"
                  className={`font-mono font-bold ${isOverdueOrHigh
                    ? 'text-rose-700'
                    : lvl === 'MEDIUM'
                      ? 'text-[#92400E]'
                      : 'text-emerald-700'
                    }`}
                >
                  {m.pctUsed !== null ? `${Math.round(m.pctUsed).toLocaleString('en-PH')}% of limit used` : m.consumptionLabel}
                </span>
              </div>

              <div
                role="progressbar"
                aria-valuenow={m.barFillPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Time limit used: ${m.consumptionLabel}`}
                className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]"
              >
                <div
                  style={{
                    width: `${m.barFillPct}%`,
                    ...(isOverdueOrHigh
                      ? {
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, rgba(255,255,255,0.22) 0, rgba(255,255,255,0.22) 6px, transparent 6px, transparent 12px)',
                      }
                      : null),
                  }}
                  className={`h-full rounded-full ${isOverdueOrHigh
                    ? 'bg-rose-600'
                    : lvl === 'MEDIUM'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                    }`}
                />
              </div>

              <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-[#E2E8F0] bg-white p-2.5">
                  <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                    Charter Limit
                  </span>
                  <span className="mt-1 block font-mono text-xs font-bold text-[#202938] sm:text-sm">
                    {m.limitText}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[#64748B]">
                    {m.limitMinutes ? `(${m.limitMinutes.toLocaleString('en-PH')} min)` : `(${m.limitSubtext})`}
                  </span>
                </div>

                <div className="rounded-lg border border-[#E2E8F0] bg-white p-2.5">
                  <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                    Elapsed Time
                  </span>
                  <span className="mt-1 block font-mono text-xs font-bold text-[#202938] sm:text-sm">
                    {m.elapsedText}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[#64748B]">
                    {m.elapsedMinutes != null ? `(${m.elapsedMinutes.toLocaleString('en-PH')} min)` : m.elapsedSubtext}
                  </span>
                </div>

                <div className="rounded-lg border border-[#E2E8F0] bg-white p-2.5">
                  <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                    Time Left
                  </span>
                  <span
                    className={`mt-1 block font-mono text-xs font-bold sm:text-sm ${minsLeft <= 0 || isOverdueOrHigh ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                  >
                    {minsLeft.toLocaleString('en-PH')} min
                  </span>
                  <span className="mt-0.5 block font-sans text-[10px] text-[#64748B]">
                    {minsLeft <= 0 ? 'Past deadline' : 'Within time limit'}
                  </span>
                </div>
              </div>
            </section>

            {/* 4. Processing Milestones */}
            <section aria-label="Processing milestones" data-testid="late-risk-drawer-milestones">
              <h3 className="font-sans text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                Processing Milestones
              </h3>

              <ol className="mt-3 space-y-3">
                {milestones.map((step, idx) => {
                  const isLast = idx === milestones.length - 1;
                  const dotClass = step.state === 'completed'
                    ? 'bg-emerald-500 ring-4 ring-emerald-50'
                    : step.state === 'stalled'
                      ? 'bg-rose-600 ring-4 ring-rose-50'
                      : step.state === 'on_track'
                        ? 'bg-emerald-500 ring-4 ring-emerald-50'
                        : 'bg-slate-300 ring-4 ring-slate-100';

                  const titleClass = step.state === 'stalled'
                    ? 'text-rose-700'
                    : 'text-[#202938]';

                  const subClass = step.state === 'stalled'
                    ? 'font-semibold text-rose-600'
                    : 'text-[#64748B]';

                  return (
                    <li key={step.id || idx} className="relative flex items-start gap-3">
                      {!isLast ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-[7px] top-5 h-full w-px bg-[#E2E8F0]"
                        />
                      ) : null}
                      <span
                        aria-hidden="true"
                        className={`relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full ${dotClass}`}
                      />
                      <div className="min-w-0 pb-1">
                        <p className={`font-sans text-xs font-bold leading-snug ${titleClass}`}>
                          {step.title}
                        </p>
                        <p className={`mt-0.5 font-mono text-[11px] ${subClass}`}>
                          {step.subtitle}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>

          {/* 5. Modal Footer Actions */}
          {item.can_open ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3.5">
              <Button
                variant={isEscalateMode ? 'secondary' : 'primary'}
                size="sm"
                data-testid="late-risk-drawer-open-record"
                onClick={() => router.push(`/transactions/${encodeURIComponent(item.transaction_id)}`)}
              >
                Open Transaction Record
              </Button>
              {isEscalateMode && !isExecutive ? (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="late-risk-drawer-escalate-btn"
                  onClick={() => setConfirmEscalate(true)}
                >
                  Confirm Escalation
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmEscalate}
        title="Escalate high-risk transaction?"
        message={`Flag ${item.tracking_no} (${item.service_name}) for immediate supervisory follow-up and open its transaction record?`}
        confirmLabel="Confirm Escalation"
        onConfirm={() => {
          setConfirmEscalate(false);
          onEscalateConfirmed?.(item);
        }}
        onCancel={() => setConfirmEscalate(false)}
      />
    </>
  );
}

export function LateRiskTable({ data, loading, showProbability, itemsOverride, onSelectAction }) {
  const [sort, setSort] = useState({ key: 'risk', direction: 'desc' });
  const rows = useMemo(() => sortRows(itemsOverride ?? data?.items ?? [], sort), [itemsOverride, data, sort]);
  const changeSort = (key) => setSort((current) => (current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'minutes' ? 'asc' : 'desc' }));

  const columns = [
    {
      key: 'tracking_no',
      header: 'Tracking # & Service',
      width: '30%',
      sortable: true,
      render: (row) => (
        <div className="min-w-0 space-y-0.5 whitespace-normal">
          {row.can_open ? (
            <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="row-action px-0 font-mono text-xs font-bold text-[#800000]">
              {row.tracking_no}
            </Link>
          ) : (
            <span className="block font-mono text-xs font-bold text-[#202938]">{row.tracking_no}</span>
          )}
          <p className="font-sans text-xs leading-snug text-[#64748B]">{row.service_name}</p>
        </div>
      ),
    },
    {
      key: 'risk',
      header: 'Risk Score',
      width: '15%',
      sortable: true,
      render: (row) => <RiskScorePill row={row} showProbability={showProbability} />,
    },
    {
      key: 'consumed',
      header: 'Charter Time Consumed',
      width: '25%',
      sortable: true,
      render: (row) => {
        const m = deriveLateRiskItemMetrics(row);
        const barTone = m.isOverLimit || row.level === 'HIGH'
          ? 'bg-rose-600'
          : row.level === 'MEDIUM'
            ? 'bg-amber-400'
            : 'bg-emerald-500';
        return (
          <div className="space-y-1.5 whitespace-normal">
            <div className="flex flex-wrap items-center justify-between gap-1.5 font-sans text-xs">
              <span className="font-mono font-semibold text-[#202938]">
                {m.pctUsed !== null ? `${Math.round(m.pctUsed).toLocaleString('en-PH')}% used` : row.reason}
              </span>
              {m.isOverLimit ? (
                <span className="rounded bg-[#FDF2F2] px-1.5 py-0.2 font-sans text-[10px] font-bold uppercase text-[#800000]">
                  Overdue
                </span>
              ) : (
                <span className="font-sans text-[11px] text-[#64748B]">Within time limit</span>
              )}
            </div>
            <div
              role="progressbar"
              aria-valuenow={m.barFillPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Charter time consumed: ${m.consumptionLabel}`}
              className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]"
            >
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${m.barFillPct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'minutes',
      header: 'Time Left',
      width: '14%',
      align: 'right',
      sortable: true,
      render: (row) => {
        const mins = Number(row.working_minutes_left ?? 0);
        const breached = mins <= 0;
        return (
          <div className="space-y-0.5 text-right">
            <span className={`block font-mono text-xs font-bold tabular-nums ${breached ? 'text-[#800000]' : 'text-[#202938]'}`}>
              {mins.toLocaleString('en-PH')} min
            </span>
            <span className={`block font-sans text-[11px] ${breached ? 'font-semibold text-rose-700' : 'text-[#64748B]'}`}>
              {breached ? 'Breached' : `${minutesText(mins)} buffer`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'Action',
      width: '16%',
      align: 'right',
      render: (row) => {
        if (!row.can_open) {
          return <span className="font-sans text-[11px] text-[#64748B]">View only</span>;
        }
        const isHigh = row.level === 'HIGH';
        const actionMode = isHigh ? 'escalate' : 'inspect';
        return (
          <button
            type="button"
            data-testid={`late-risk-action-${actionMode}`}
            onClick={() => onSelectAction?.(row, actionMode)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${isHigh
              ? 'border-[#F3C5C5] bg-[#FDF2F2] text-[#800000] hover:bg-[#F8EEEE]'
              : 'border-[#E2E8F0] bg-white text-[#202938] hover:bg-[#F8FAFC]'
              }`}
          >
            <span>{isHigh ? 'Escalate' : 'Inspect'}</span>
            <span aria-hidden="true">&rsaquo;</span>
          </button>
        );
      },
    },
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
      minWidth="36rem"
      sort={sort}
      onSortChange={changeSort}
    />
  );
}

/**
 * Late-risk monitoring page:
 * 1. Top Control Bar (Office selector, search field, risk category filters with dynamic counts, Super Admin Retrain).
 * 2. Two-column main content: Ranked Open Transactions table (left ~67%) and Scoring Model panel (right ~33%).
 * 3. Slide-over Escalate / Inspect detail drawer for the selected transaction.
 * The four KPI summary containers remain omitted.
 */
export default function LateRiskSection({
  user,
  embedded = false,
  officeId: controlledOfficeId,
  scores: preloadedScores,
  loading: preloadedLoading = false,
  error: preloadedError = '',
}) {
  const isAdmin = user?.role === ROLES.SUPER_ADMIN;
  const isExecutive = user?.role === ROLES.EXECUTIVE;
  const campus = isAdmin || isExecutive;
  const once = useSingleSubmit();

  const [offices, setOffices] = useState([]);
  const [officeId, setOfficeId] = useState(user?.officeId ?? '');
  const [scores, setScores] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [training, setTraining] = useState(false);
  const [revision, setRevision] = useState(0);

  const [riskFilter, setRiskFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailTarget, setDetailTarget] = useState(null); // { item, mode: 'escalate' | 'inspect' }

  useEffect(() => {
    if (embedded || !campus) return undefined;
    let active = true;
    apiFetch(OFFICES_API).then(({ items }) => {
      if (!active) return;
      const available = (items ?? []).filter((office) => office.is_active !== false);
      setOffices(available);
      setOfficeId((current) => current || available[0]?.office_id || '');
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [embedded, campus]);

  useEffect(() => {
    if (embedded || !officeId) return undefined;
    let active = true;
    const url = `${API}?officeId=${encodeURIComponent(officeId)}`;
    const refresh = () => apiFetch(url).then((data) => {
      if (active) { setScores({ officeId, data }); setError(''); }
    }).catch((failure) => { if (active) setError(failure.message); });
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [embedded, officeId, revision]);

  async function retrain() {
    await once(async () => {
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
    });
  }

  const activeOfficeId = embedded ? (controlledOfficeId ?? '') : officeId;
  const activeOfficeName = offices.find((o) => o.office_id === activeOfficeId)?.office_name || 'Assigned Office';
  const data = embedded ? preloadedScores : (scores?.officeId === activeOfficeId ? scores.data : null);
  const activeError = embedded ? preloadedError : error;
  const loading = embedded ? preloadedLoading : (Boolean(activeOfficeId) && !data && !activeError);

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return {
      total: items.length,
      HIGH: items.filter((i) => i.level === 'HIGH').length,
      MEDIUM: items.filter((i) => i.level === 'MEDIUM').length,
      LOW: items.filter((i) => i.level === 'LOW').length,
    };
  }, [data]);

  const filteredItems = useMemo(() => {
    const raw = data?.items ?? [];
    const byLevel = riskFilter === 'ALL' ? raw : raw.filter((i) => i.level === riskFilter);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byLevel;
    return byLevel.filter((i) => (
      String(i.tracking_no ?? '').toLowerCase().includes(q)
      || String(i.service_name ?? '').toLowerCase().includes(q)
      || String(i.reason ?? '').toLowerCase().includes(q)
    ));
  }, [data?.items, riskFilter, searchQuery]);

  const shown = (n) => (data ? n.toLocaleString('en-PH') : '-');

  const filterButtons = [
    { id: 'ALL', label: 'All', count: shown(counts.total), testId: 'late-risk-open', dot: null },
    { id: 'HIGH', label: 'High Risk', count: shown(counts.HIGH), testId: 'late-risk-high', dot: 'bg-rose-600' },
    { id: 'MEDIUM', label: 'Medium Risk', count: shown(counts.MEDIUM), testId: 'late-risk-medium', dot: 'bg-amber-500' },
    { id: 'LOW', label: 'Low Risk', count: shown(counts.LOW), testId: 'late-risk-low', dot: 'bg-emerald-500' },
  ];

  const modelBadge = !data?.model
    ? { label: 'Unavailable', variant: 'neutral' }
    : data.model.method === 'trained'
      ? { label: 'Trained', variant: 'success' }
      : { label: 'Rule-based', variant: 'neutral' };

  return (
    <div className="space-y-4" data-testid="late-risk-section">
      {!embedded ? <ErrorBanner message={activeError} onDismiss={() => setError('')} /> : (activeError ? <p className="text-sm text-slate-600">{activeError}</p> : null)}
      {!embedded ? <StatusBanner variant="success" message={notice} onDismiss={() => setNotice('')} dismissAriaLabel="Dismiss message" /> : null}

      {/* 1. Top Control Bar */}
      <div
        aria-label="Deadline risk controls"
        data-testid="late-risk-toolbar"
        className="card flex flex-col gap-3 p-4 sm:p-5 2xl:flex-row 2xl:items-center 2xl:justify-between"
      >
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 sm:min-w-[16rem] sm:max-w-sm">
            <label htmlFor="late-risk-search" className="sr-only">Search tracking number or service</label>
            <SearchInput
              id="late-risk-search"
              data-testid="late-risk-search"
              aria-label="Search tracking number or service"
              customPlaceholder="Search tracking # or service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {!embedded && campus ? (
            <div className="w-full sm:w-56">
              <label htmlFor="late-risk-office" className="sr-only">Office</label>
              <select
                id="late-risk-office"
                value={officeId}
                onChange={(event) => {
                  setOfficeId(event.target.value);
                  setDetailTarget(null);
                }}
                className="input select-chevron font-medium"
              >
                <option value="" disabled>Select an office</option>
                {offices.map((office) => (
                  <option key={office.office_id} value={office.office_id}>
                    {office.office_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 xl:justify-end">
          <div
            role="group"
            aria-label="Filter by risk category"
            className="flex flex-wrap items-center gap-1.5"
            data-testid="late-risk-filters"
          >
            {filterButtons.map((btn) => {
              const selected = riskFilter === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRiskFilter(btn.id)}
                  data-testid={btn.testId}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${selected
                    ? 'border-[#800000] bg-[#800000] text-white shadow-2xs'
                    : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300 hover:text-[#202938]'
                    }`}
                >
                  {btn.dot && !selected ? <span aria-hidden="true" className={`h-2 w-2 rounded-full ${btn.dot}`} /> : null}
                  <span>{btn.label}</span>
                  <span className="font-mono text-[11px] tabular-nums">({btn.count})</span>
                </button>
              );
            })}
          </div>

          {!embedded && isAdmin ? (
            <Button onClick={retrain} loading={training} loadingLabel="Training…" className="w-full sm:w-auto">
              Retrain
            </Button>
          ) : null}
        </div>
      </div>

      {!activeOfficeId ? (
        <EmptyState role="status">
          {embedded ? 'Choose an office above to see its open transactions ranked by deadline risk.' : 'Select an office to see its open transactions ranked by risk.'}
        </EmptyState>
      ) : (
        /* 2. Two-Column Main Content: Ranked Open Transactions (~67%) + Scoring Model (~33%) */
        <div className="grid items-start gap-5 lg:grid-cols-12">
          {/* Left Panel: Ranked Open Transactions Table */}
          <section
            aria-labelledby="ranked-open-tx-title"
            data-testid="late-risk-table-panel"
            className="min-w-0 space-y-3 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs sm:p-5 lg:col-span-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="ranked-open-tx-title" className="font-sans text-base font-bold text-[#202938]">
                  Ranked Open Transactions
                </h2>
                <span
                  data-testid="late-risk-queue-count"
                  className="inline-flex items-center rounded-md border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-mono text-xs font-semibold text-[#64748B]"
                >
                  Showing {filteredItems.length} of {counts.total}
                </span>
              </div>

              {data?.as_of ? (
                <p className="font-sans text-xs text-[#64748B]" data-testid="late-risk-timestamp">
                  {data.stale ? 'Showing saved results as of ' : 'Results as of '}
                  <time dateTime={data.as_of}>{formatDateTime(data.as_of)}</time>
                </p>
              ) : null}
            </div>

            <LateRiskTable
              data={data}
              loading={loading}
              showProbability={isAdmin}
              itemsOverride={filteredItems}
              onSelectAction={(row, mode) => setDetailTarget({ item: row, mode })}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3 font-sans text-xs text-[#64748B]">
              <span>Working-time calculations automatically pause outside official campus hours &amp; holidays.</span>
              <span>Click Escalate or Inspect to view milestones</span>
            </div>
          </section>

          {/* Right Panel: Scoring Model */}
          <section
            aria-labelledby="scoring-model-title"
            data-testid="late-risk-model-panel"
            className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs sm:p-5 lg:col-span-4"
          >
            <div className="flex items-start justify-between gap-2 border-b border-[#E2E8F0] pb-3.5">
              <div>
                <h2 id="scoring-model-title" className="font-sans text-base font-bold text-[#202938]">
                  Scoring model
                </h2>
                <p className="mt-0.5 font-sans text-xs text-[#64748B]">
                  How the risk levels are worked out.
                </p>
              </div>
              <StatusBadge variant={modelBadge.variant}>{modelBadge.label}</StatusBadge>
            </div>

            <div className="mt-4">
              <LateRiskModelSummary model={data?.model} />
            </div>
          </section>
        </div>
      )}

      {/* 3. Escalate / Inspect Slide-Over Transaction Detail Drawer */}
      <LateRiskDetailDrawer
        item={detailTarget?.item ?? null}
        mode={detailTarget?.mode ?? 'inspect'}
        officeName={activeOfficeName}
        asOf={data?.as_of ?? null}
        showProbability={isAdmin}
        isExecutive={isExecutive}
        onClose={() => setDetailTarget(null)}
        onEscalateConfirmed={(item) => {
          setNotice(`Escalation logged for ${item.tracking_no}. Follow-up notification queued.`);
          setDetailTarget(null);
        }}
      />
    </div>
  );
}
