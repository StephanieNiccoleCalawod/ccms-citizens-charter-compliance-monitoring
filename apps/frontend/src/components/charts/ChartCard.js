'use client';

import { useState } from 'react';
import CalculationInfo from '../analytics/CalculationInfo.js';
import EmptyState from '../ui/EmptyState.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';

// The frame every Insights chart sits in: title, optional comparison badge, Chart/Table toggle, one-line description,
// legend, the chart itself or an empty state, and a footer / table view of the same numbers.

/** A legend entry: a short line (solid or dashed) or a swatch, with its name in normal text colour. */
export function LegendItem({ color, label, dashed = false, shape = 'line' }) {
  return (
    <li className="inline-flex items-center gap-2 text-xs font-medium text-[#202938]">
      <svg aria-hidden="true" width="22" height="10" viewBox="0 0 22 10">
        {shape === 'line' ? (
          <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dashed ? '5 4' : undefined} />
        ) : (
          <rect x="3" y="1" width="16" height="8" rx="2" fill={color} />
        )}
      </svg>
      {label}
    </li>
  );
}

/** Compact Chart / Table segmented toggle used in analytics card headers (View as table). */
export function ChartTableToggle({ mode, onChange, testIdPrefix = 'chart' }) {
  return (
    <div
      role="group"
      aria-label="View as table"
      className="inline-flex shrink-0 items-center rounded-lg border border-[#E2E8F0] bg-[#F4F5F8] p-0.5"
      data-testid={`${testIdPrefix}-view-toggle`}
    >
      {[
        ['chart', 'Chart'],
        ['table', 'Table'],
      ].map(([key, label]) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            data-testid={`${testIdPrefix}-mode-${key}`}
            className={`cursor-pointer rounded-md px-2.5 py-1 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
              active
                ? 'bg-white text-[#202938] shadow-2xs'
                : 'text-[#64748B] hover:text-[#202938]'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The "View as table" disclosure's table: the shared CCMS table. columns: [{ key, label, align }]; rows: plain objects. */
export function DataTable({ caption, columns, rows }) {
  return (
    <TableShell>
      <Table
        label={caption}
        minWidth="20rem"
        head={
          <tr>
            {columns.map((c) => (
              <Th key={c.key} align={c.align}>{c.label}</Th>
            ))}
          </tr>
        }
      >
        {rows.map((row, i) => (
          <tr key={i} className="tr-row">
            {columns.map((c, idx) => (
              <td key={c.key} className={`td ${c.align === 'right' ? 'text-right td-num' : idx === 0 ? 'td-medium' : ''}`.trim()}>
                {row[c.key] ?? '-'}
              </td>
            ))}
          </tr>
        ))}
      </Table>
    </TableShell>
  );
}

export default function ChartCard({
  id,
  title,
  badge = null,
  headerRight = null,
  calculation,
  calculationSubject = null,
  description,
  legend = null,
  empty = false,
  emptyMessage = 'No data to show yet.',
  emptyTitle = null,
  emptyVariant = 'neutral',
  emptyIcon = 'chart',
  emptySupport = null,
  emptyAction = null,
  table = null,
  footer = null,
  className = '',
  children,
}) {
  const [viewMode, setViewMode] = useState('chart');
  const showToggle = Boolean(table && !empty);
  // S8-46: a chart that passes `calculation` (even null) gets the "How is this calculated?" control.
  const showCalculation = calculation !== undefined;

  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`card flex h-full flex-col min-w-0 p-5 ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-title`} className="title-card text-[#202938]">{title}</h3>
            {badge}
          </div>
          {description ? <p className="mt-1 font-sans text-xs text-[#64748B] sm:text-sm">{description}</p> : null}
        </div>
        {headerRight || showToggle || showCalculation ? (
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            {showCalculation ? <CalculationInfo calculation={calculation} subject={calculationSubject ?? title.toLowerCase()} testId={`${id}-calc`} /> : null}
            {showToggle ? <ChartTableToggle mode={viewMode} onChange={setViewMode} testIdPrefix={id} /> : null}
          </div>
        ) : null}
      </div>

      {legend && !empty && viewMode === 'chart' ? (
        <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Legend">{legend}</ul>
      ) : null}

      <div className="mt-4 flex-1">
        {empty ? (
          <EmptyState
            role="status"
            surface="subtle"
            size="compact"
            variant={emptyVariant}
            icon={emptyIcon}
            title={emptyTitle}
            supportingInfo={emptySupport}
            action={emptyAction}
            data-testid={`${id}-empty`}
          >
            {emptyMessage}
          </EmptyState>
        ) : viewMode === 'table' && table ? (
          <div data-testid={`${id}-table-view`}>
            <DataTable {...table} />
          </div>
        ) : (
          children
        )}
      </div>

      {footer ? (
        <div className="mt-auto border-t border-[#E2E8F0] pt-3 font-sans text-xs text-[#64748B]">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
