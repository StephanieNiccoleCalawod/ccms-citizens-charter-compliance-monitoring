'use client';

import { useEffect, useRef, useState } from 'react';
import Pager from '../navigation/Pager.js';
import TableShell, { Table, Th } from './TableShell.js';
import TableState from './TableState.js';

/**
 * Accessible truncated text cell with inline keyboard/touch expansion.
 * - Single-line CSS ellipsis while collapsed.
 * - The expand control only appears when the rendered text is actually clipped
 *   (scrollWidth > clientWidth), re-measured on resize and when the text changes.
 * - Full original text stays in the data, in the `title`, and in the toggle's aria-label.
 */
export function TruncatedCell({
  text,
  subtitle,
  href,
  onClick,
  className = '',
}) {
  const [expanded, setExpanded] = useState(false);
  // Starts false so server and first client render match (no hydration mismatch).
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return undefined; // an expanded cell is not clipped; keep the toggle
    const measure = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  const showToggle = isTruncated || expanded;

  const content = (
    <span
      ref={textRef}
      className={`block font-semibold text-slate-900 hover:underline ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}
    >
      {text}
    </span>
  );

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1" title={text}>
          {href ? (
            <a href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] rounded">
              {content}
            </a>
          ) : onClick ? (
            <button
              type="button"
              onClick={onClick}
              className="block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] rounded w-full"
            >
              {content}
            </button>
          ) : (
            content
          )}
        </div>
        {showToggle ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse title: ${text}` : `Expand title: ${text}`}
            className="shrink-0 rounded px-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
          >
            {expanded ? '▲' : '…'}
          </button>
        ) : null}
      </div>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500 truncate" title={subtitle}>{subtitle}</p> : null}
    </div>
  );
}

/**
 * Column-driven table for the lists that need little more than a header and rows (the Service Catalogue).
 * It is a thin layer over the shared table design: <TableShell>, <Table>, <Th> and <Pager> decide how it looks,
 * so it looks like every other CCMS table. This component only maps columns and rows onto them and adds the optional
 * summary bar. columns: [{ key, header, width?, align?, className?, headerClassName?, render?(item, index) }].
 */
export default function DataTable({
  columns = [],
  data = [],
  keyExtractor = (item, idx) => item.id ?? item.service_id ?? idx,
  rowClassName = () => '',
  loading = false,
  loadingMessage = 'Loading…',
  emptyMessage = 'No records found.',
  error = null,
  summaryText = null,
  totalCount = null,
  countLabel = 'records',
  summaryLeftSlot = null,
  summaryRightSlot = null,
  pagination = null, // { page, pageSize, total, onPage, onPageSizeChange, pageSizeOptions, loading }
  minWidth = '35rem',
  className = '',
}) {
  const hasSummary = summaryText || summaryLeftSlot || totalCount !== null || summaryRightSlot;
  const colCount = columns.length;
  const alignClass = (col) => (col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left');

  return (
    <TableShell className={className} footer={pagination ? <Pager {...pagination} loading={loading || pagination.loading} /> : null}>
      {/* Optional summary bar above the header */}
      {hasSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="text-sm text-stone-600">{summaryLeftSlot ?? (summaryText ? <p>{summaryText}</p> : null)}</div>
          <div>
            {summaryRightSlot ?? (
              totalCount !== null ? (
                <div className="text-right">
                  <span className="block text-base font-bold leading-tight text-stone-900">{totalCount}</span>
                  <span className="block text-xs leading-tight text-stone-500">{countLabel}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      <Table
        className="table-fixed"
        minWidth={minWidth}
        busy={loading}
        head={
          <tr>
            {columns.map((col) => (
              <Th key={col.key || col.header} style={col.width ? { width: col.width } : undefined} className={`${alignClass(col)} ${col.headerClassName || ''}`.trim()}>
                {col.header}
              </Th>
            ))}
          </tr>
        }
      >
        {error ? (
          <TableState colSpan={colCount} kind="error">{error}</TableState>
        ) : loading ? (
          <TableState colSpan={colCount} kind="loading">{loadingMessage}</TableState>
        ) : data.length === 0 ? (
          <TableState colSpan={colCount}>{emptyMessage}</TableState>
        ) : (
          data.map((item, idx) => {
            const customRowClass = typeof rowClassName === 'function' ? rowClassName(item, idx) : rowClassName;
            return (
              <tr key={keyExtractor(item, idx)} className={`tr-row ${customRowClass || ''}`.trim()}>
                {columns.map((col) => (
                  <td key={col.key || col.header} className={`td ${alignClass(col)} ${col.className || ''}`.trim()}>
                    {col.render ? col.render(item, idx) : item[col.key]}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </Table>
    </TableShell>
  );
}

DataTable.TruncatedCell = TruncatedCell;
