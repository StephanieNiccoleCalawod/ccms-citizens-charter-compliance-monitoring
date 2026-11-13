import Link from 'next/link';
import Spinner from './Spinner.js';

// The look lives in globals.css (btn, btn-<variant>, btn-<size>); this component only picks the classes and adds the
// shared behaviour: a loading state (spinner + busy label, disabled, aria-busy), optional leading/trailing icons, and
// rendering as a Next.js link when given href.
export const BUTTON_VARIANTS = Object.freeze({
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
  link: 'btn-link',
});

export const BUTTON_SIZES = Object.freeze({ sm: 'btn-sm', md: '', lg: 'btn-lg', icon: 'btn-icon' });

/** The class string for a variant and size, for the rare element that cannot be a <Button> (e.g. a <label> styled as a button). */
export function buttonClasses({ variant = 'primary', size = 'md', className = '' } = {}) {
  const base = BUTTON_VARIANTS[variant] ?? '';
  const sized = variant === 'link' ? '' : BUTTON_SIZES[size] ?? '';
  return [base, sized, className].filter(Boolean).join(' ');
}

/**
 * The one CCMS button.
 *   <Button onClick={save}>Save</Button>
 *   <Button variant="secondary" size="sm" leadingIcon={<PlusIcon />}>Add step</Button>
 *   <Button type="submit" form="office-form" variant="success" loading={busy} loadingLabel="Saving…">Save</Button>
 *   <Button href="/transactions/new">Add transaction</Button>
 * `variant` is one of primary, secondary, outline, ghost, danger, success, link; `size` is sm, md (default), lg or icon.
 * Pass `variant={null}` with a className only to keep an existing class (SubmitButton's className prop).
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  loading = false,
  loadingLabel,
  leadingIcon = null,
  trailingIcon = null,
  disabled = false,
  href,
  className = '',
  children,
  ref,
  ...props
}) {
  const classes = variant === null ? className : buttonClasses({ variant, size, className });
  const busy = Boolean(loading);
  const content = (
    <>
      {busy ? <Spinner /> : leadingIcon}
      {busy && loadingLabel ? loadingLabel : children}
      {busy ? null : trailingIcon}
    </>
  );

  if (href && !disabled) {
    return (
      <Link ref={ref} href={href} className={classes} {...props}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={classes} disabled={busy || disabled} aria-busy={busy || undefined} {...props}>
      {content}
    </button>
  );
}
