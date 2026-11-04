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
