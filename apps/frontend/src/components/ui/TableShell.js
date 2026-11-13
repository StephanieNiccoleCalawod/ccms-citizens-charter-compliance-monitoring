// The one table design every CCMS list uses (the Audit Logs table is the reference). Pages bring their columns
// and rows; the container, header, separators, row look and the pagination footer come from here:
//
//   <TableShell footer={<Pager ... />}>
//     <Table busy={loading} minWidth="40rem" head={<tr><Th>Name</Th><Th align="right">Actions</Th></tr>}>
//       <tr className="tr-row"><td className="td">...</td></tr>
//     </Table>
//   </TableShell>
//
// The look itself lives in globals.css (table-shell, table-head, th, td, tr-row), so the colours, borders and
// spacing are changed in one place.

/** The white, warm-bordered, rounded container. It clips the header and rows to the rounded corners and holds the footer (pagination). */
export default function TableShell({ children, footer = null, className = '' }) {
  return (
    <div className={`table-shell ${className}`.trim()}>
      {children}
      {footer}
    </div>
  );
}

/** One header cell: uppercase white label on the shared burgundy header, with a thin separator. */
export function Th({ align = 'left', className = '', children, ...props }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  return (
    <th scope="col" className={`th ${alignClass} ${className}`.trim()} {...props}>
      {children}
    </th>
  );
}

/** A row's own heading cell in the body (a grid like the Insights heatmap): a real row header, styled as a strong body cell. */
export function RowHeader({ className = '', children, ...props }) {
  return (
    <th scope="row" className={`td whitespace-nowrap text-left font-semibold text-slate-900 ${className}`.trim()} {...props}>
      {children}
    </th>
  );
}

/** A full-width section heading row inside the body (grouping the rows below it, e.g. the Roles and permissions matrix). */
export function GroupRow({ colSpan, children, className = '' }) {
  return (
    <tr className="bg-slate-50">
      <th scope="colgroup" colSpan={colSpan} className={`td text-left text-xs font-bold uppercase tracking-wide text-slate-500 ${className}`.trim()}>
        {children}
      </th>
    </tr>
  );
}

/** The scrolling table: shared burgundy header (head is a <tr>), white body with hairline separators. Wide tables scroll inside the shell. */
export function Table({ head, children, busy = false, minWidth, label, className = '' }) {
  return (
    // relative: visually hidden labels (a sr-only header like "Details") are positioned inside this box, so they
    // scroll with the table instead of widening the whole page on a phone.
    <div className="relative overflow-x-auto">
      <table className={`w-full text-left ${className}`.trim()} style={minWidth ? { minWidth } : undefined} aria-busy={busy || undefined} aria-label={label}>
        <thead className="table-head">{head}</thead>
        <tbody className="divide-y divide-table-divider bg-white">{children}</tbody>
      </table>
    </div>
  );
}
