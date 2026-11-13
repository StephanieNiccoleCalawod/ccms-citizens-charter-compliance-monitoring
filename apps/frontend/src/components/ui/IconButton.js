/**
 * A button that shows only an icon: the header hamburger and bell, a modal's close X, the calendar month arrows.
 * It must have an accessible name: pass `label` (or an explicit aria-label). The icon itself is decorative (aria-hidden).
 * variant: 'ghost' (default, no border) or 'outline' (hairline border, white). Table rows keep their own smaller
 * row-icon-button (see RowActionMenu), so a row's controls stay compact.
 */
export default function IconButton({ label, variant = 'ghost', className = '', type = 'button', children, ref, ...props }) {
  const base = variant === 'outline' ? 'icon-button-outline' : 'icon-button';
  return (
    <button ref={ref} type={type} aria-label={label} title={props.title ?? label} className={`${base} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
