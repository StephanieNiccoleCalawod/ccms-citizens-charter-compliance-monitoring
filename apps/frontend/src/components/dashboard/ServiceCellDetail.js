'use client';

import { minutesText } from '../../lib/ui/insights.js';
import Button from '../ui/Button.js';
import LoadingState from '../ui/LoadingState.js';

/**
 * Shared weekly breakdown and authorized late transactions detail panel for a selected office+service cell.
 * Reused by both ServiceLateRateMatrix and the Charter Time Limits by Service table without duplicating the detail UI.
 */
export default function ServiceCellDetail({
  cell,
  cellData,
  onClose,
  testId = 'cell-detail',
  summaryTestId = 'cell-detail-summary',
}) {
  if (!cell) return null;
  const completed = cell.completed ?? 0;
  const late = cell.late ?? 0;
  const rateText = cell.too_few || completed < 5 ? 'Too few to judge' : `${cell.late_rate}% late`;

  return (
    <div className="mt-4 rounded-xl border border-[#E2E8F0] bg-[#F4F5F8] p-4 text-sm text-[#202938]" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-sans text-sm font-bold text-[#202938]">
            {cell.service_name}{' '}
            · {cell.office_name}
          </h4>
          <p className="mt-1 font-sans text-xs text-[#64748B]" data-testid={summaryTestId}>
            Completed: <span className="font-semibold text-[#202938]">{completed}</span> · Late:{' '}
            <span className="font-semibold text-[#202938]">{late}</span> · Rate:{' '}
            <span className="font-semibold text-[#202938]">{rateText}</span>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
      {!cellData ? (
        <LoadingState className="mt-3" />
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-sans text-xs font-bold uppercase tracking-wide text-[#64748B]">Weekly late rate</p>
            {cellData.weekly?.length ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[#202938]">
                {cellData.weekly.map((w) => (
                  <li key={w.week_start}>
                    Week of {w.week_start}: {w.late_rate}% late ({w.late} of {w.completed})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-[#64748B]">No weekly breakdown recorded in this period.</p>
            )}
          </div>
          <div>
            <p className="font-sans text-xs font-bold uppercase tracking-wide text-[#64748B]">Late transactions</p>
            {cellData.late_transactions?.length ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[#202938]">
                {cellData.late_transactions.map((t) => (
                  <li key={t.tracking_no}>
                    <span className="font-mono text-xs">{t.tracking_no}</span> · {minutesText(t.variance_minutes)} over the limit
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-[#64748B]">None in this period.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
