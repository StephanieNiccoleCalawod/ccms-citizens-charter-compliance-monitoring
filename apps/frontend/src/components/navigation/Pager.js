'use client';

export const DEFAULT_PAGE_SIZES = [10, 20, 50, 100];

function Chevron({ direction }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'previous' ? <path d="m12 4-6 6 6 6" /> : <path d="m8 4 6 6-6 6" />}
    </svg>
  );
}

/**
 * Shared server-side pagination footer for CCMS tables (put it in <TableShell footer={...}>).
 *
 * Standard layout (the reference): "Items per page:" with a compact list on the left; Previous, the current page
 * and Next on the right, the current page in maroon and the arrows muted (and dimmer when disabled).
 * It only reports what the person asked for: onPage(n) and onPageSizeChange(n). The page owns the request,
 * so filters and sorting stay as they are and the page decides to start again at page 1 when the size changes.
 *
 * The public services page uses this same pager for its cards (with its own page sizes, in whole grid rows).
 */
export default function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  loading = false,
  className = '',
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // The chosen size is always one of the choices, even when a page was opened with an unusual size.
  const sizes = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div className={`table-pager ${className}`.trim()}>
      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
        <span>Items per page:</span>
        <select
          aria-label="Items per page"
          className="page-size-select"
          value={pageSize}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          disabled={!onPageSizeChange || loading}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <p className="sr-only" aria-live="polite">
        Showing {first} to {last} of {total}
      </p>
      <nav aria-label="Pagination" className="ml-auto inline-flex items-center gap-2">
        <button type="button" aria-label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 1 || loading} className="page-arrow">
          <Chevron direction="previous" />
        </button>
        <span className="page-current" aria-current="page" aria-label={`Page ${page} of ${pages}`}>
          {page}
        </span>
        <button type="button" aria-label="Next page" onClick={() => onPage(page + 1)} disabled={page >= pages || loading} className="page-arrow">
          <Chevron direction="next" />
        </button>
      </nav>
    </div>
  );
}
