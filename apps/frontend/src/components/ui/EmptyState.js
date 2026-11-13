/**
 * "Nothing to show" inside a card or a page section: a dashed, muted box with the message (and an optional action, e.g. "Add office").
 * Pass role="status" when the box replaces content that was loading, so screen readers hear the result.
 * `icon` is an optional decorative illustration above the title (a small inline SVG; it is given aria-hidden by the caller).
 * Inside a table use <TableState> (a row) instead.
 */
export default function EmptyState({ icon, title, children, action, className = '', ...props }) {
  return (
    <div className={`rounded-card border border-dashed border-line bg-surface-muted px-4 py-10 text-center text-sm text-slate-600 ${className}`.trim()} {...props}>
      {icon ? <div className="mb-3 flex justify-center text-slate-400">{icon}</div> : null}
      {title ? <p className="font-semibold text-slate-900">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
