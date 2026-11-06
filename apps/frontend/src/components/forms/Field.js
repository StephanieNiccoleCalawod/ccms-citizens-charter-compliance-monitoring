// Small pieces every form shares: the mandatory-field asterisk, and the message under a field. Inputs show the red border through aria-invalid (see .input in globals.css).

/** The red asterisk after the label of a mandatory field (hidden from screen readers; the input has aria-required). */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-red-700">
      *
    </span>
  );
}

/** The specific message under the field it belongs to. `id` is what the field's aria-describedby points at. */
export function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-700">
      {children}
    </p>
  );
}

/** A visible, non-blocking warning (amber). Saving stays possible. */
export function FieldWarning({ children }) {
  if (!children) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3 2.5 16.5h15L10 3Z" />
        <path d="M10 8v4M10 14.2v.1" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
