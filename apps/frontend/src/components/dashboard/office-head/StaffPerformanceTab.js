'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HOME_MESSAGES, sortStaffRows } from '../../../lib/ui/kpi-home.js';
import TableShell, { Table, Th } from '../../ui/TableShell.js';
import TableState from '../../ui/TableState.js';

const SORT_OPTIONS = [
  { key: 'pending', direction: 'desc', label: 'Highest Pending Workload' },
  { key: 'late', direction: 'desc', label: 'Most Late Transactions' },
  { key: 'completed', direction: 'desc', label: 'Highest Completed Transactions' },
  { key: 'rate', direction: 'asc', label: 'Lowest On-Time Rate' },
];

function PendingPill({ value }) {
  const tone = value === 0 ? 'bg-slate-100 text-slate-600' : value >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-full px-2 py-0.5 font-sans text-xs font-semibold tabular-nums ${tone}`}>{value}</span>;
}

function RateBar({ rate }) {
  if (rate === null) return <span className="td-muted">{HOME_MESSAGES.noRate}</span>;
  const tone = rate >= 95 ? 'bg-emerald-600' : rate >= 90 ? 'bg-amber-500' : 'bg-red-700';
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, rate))}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right td-num font-semibold">{rate}%</span>
    </div>
  );
}

/** Tab 3: the same per-staff figures Office Home has always shown (staffRows in lib/ui/kpi-home.js), with sorting added. */
export default function StaffPerformanceTab({ rows, positions = new Map(), loading }) {
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const sorted = sortStaffRows(rows, sort);

  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="office-head-staff-heading" data-testid="office-head-staff">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="office-head-staff-heading" className="title-card">By Staff Member</h2>
          <p className="mt-1 text-xs text-ink-muted sm:text-sm">Workload and Citizen&rsquo;s Charter on-time performance across your office&rsquo;s staff.</p>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="office-head-staff-sort" className="label">Sort by</label>
          <select
            id="office-head-staff-sort"
            className="input select-chevron"
            value={SORT_OPTIONS.indexOf(sort)}
            onChange={(e) => setSort(SORT_OPTIONS[Number(e.target.value)])}
          >
            {SORT_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <TableShell>
        <Table
          busy={loading}
          minWidth="48rem"
          label="Figures by staff member"
          head={(
            <tr>
              <Th>Staff Member</Th>
              <Th align="right">Received (Period)</Th>
              <Th align="right">Completed (Period)</Th>
              <Th align="right">Pending (Live)</Th>
              <Th align="right">Late</Th>
              <Th align="right">On-Time Rate</Th>
              <Th align="right">Details</Th>
            </tr>
          )}
        >
          {loading && sorted.length === 0 ? <TableState colSpan={7} kind="loading">Loading…</TableState> : null}
          {!loading && sorted.length === 0 ? (
            <TableState colSpan={7} icon="users" title="No Staff Records for This Period">
              {HOME_MESSAGES.empty}
            </TableState>
          ) : null}
          {sorted.map((row) => {
            const position = positions.get(row.id);
            return (
              <tr key={row.id} className="tr-row">
                <td className="td">
                  <span className="block td-primary">{row.name}</span>
                  {position && position !== '-' ? <span className="td-secondary">{position}</span> : null}
                </td>
                <td className="td text-right td-num">{row.received}</td>
                <td className="td text-right td-num">{row.completed}</td>
                <td className="td text-right"><PendingPill value={row.pending} /></td>
                <td className="td text-right td-num"><span className={row.late > 0 ? 'font-semibold text-red-700' : 'text-ink-muted'}>{row.late}</span></td>
                <td className="td text-right"><RateBar rate={row.rate} /></td>
                <td className="td text-right">
                  <Link href="/transactions" className="row-action">Queue &rarr;</Link>
                </td>
              </tr>
            );
          })}
        </Table>
      </TableShell>

      <p className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Fair workload note:</span> staff assigned to multi-step or multi-day services naturally carry higher active pending counts than staff on same-day services. Compare on-time rate within similar service assignments rather than pending counts alone.
      </p>
    </section>
  );
}
