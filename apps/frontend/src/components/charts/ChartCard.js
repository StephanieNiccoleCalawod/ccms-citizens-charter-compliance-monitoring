import TableShell, { Table, Th } from '../ui/TableShell.js';

// The frame every Insights chart sits in: title, one-line description, legend, the chart itself or an empty state, and a table
// view of the same numbers (so nothing is reachable only by hovering or by colour). Charts bring only their plot.

/** A legend entry: a short line (solid or dashed) or a swatch, with its name in normal text colour. */
export function LegendItem({ color, label, dashed = false, shape = 'line' }) {
  return (
    <li className="inline-flex items-center gap-2 text-xs text-slate-700">
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
            {columns.map((c) => (
              <td key={c.key} className={`td ${c.align === 'right' ? 'text-right' : ''}`}>
                {row[c.key] ?? '-'}
              </td>
            ))}
          </tr>
        ))}
      </Table>
    </TableShell>
  );
}

export default function ChartCard({ id, title, description, legend = null, empty = false, emptyMessage = 'No data to show yet.', table = null, className = '', children }) {
  return (
    <section aria-labelledby={`${id}-title`} className={`card flex h-full flex-col p-5 ${className}`.trim()}>
      <h3 id={`${id}-title`} className="title-card">{title}</h3>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      {legend && !empty ? <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">{legend}</ul> : null}
      <div className="mt-4 flex-1">
        {empty ? (
          <div role="status" data-testid={`${id}-empty`} className="rounded-xl border border-dashed border-[#EAE3D9] bg-[#FBF8F3] px-4 py-10 text-center text-sm text-slate-600">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
      {table && !empty ? (
        <details className="mt-auto pt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-maroon-800">View as table</summary>
          <div className="mt-2">
            <DataTable {...table} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
