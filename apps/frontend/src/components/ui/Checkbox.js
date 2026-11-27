'use client';

/**
 * The one CCMS checkbox: fixed 1rem box, rounded corners, slate border, the same maroon accent as the rest
 * of the design system when checked, and a visibly dimmed, non-interactive look when disabled. `label` (and
 * optional `description`) renders the usual "box + text" row, with the box pinned to the top so long label
 * text wraps underneath it instead of overlapping; pass no label to use the input on its own (e.g. inside a
 * table cell that already has its own label).
 */
export default function Checkbox({ label, description, className = '', ...props }) {
  const input = (
    <input
      type="checkbox"
      className={`mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-pup-maroon focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label className={`flex items-start gap-3 text-sm text-slate-800 ${props.disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      {input}
      <span className="min-w-0">
        {label}
        {description ? <span className="block text-xs text-slate-500">{description}</span> : null}
      </span>
    </label>
  );
}
