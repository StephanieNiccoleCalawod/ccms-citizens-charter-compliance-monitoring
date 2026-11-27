import Link from 'next/link';

const ICONS = {
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.3 2.3 4.8-4.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  bell: (
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  document: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M16.5 14c2.1.3 4 1.8 4 4" />
    </>
  ),
  building: (
    <>
      <path d="M4 21h16" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M10 7h4M10 11h4M10 15h4" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15v-4M12 15V7M17 15v-6" />
    </>
  ),
  shield: (
    <path d="M12 3 4 7v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V7l-8-4Z" />
  ),
  sync: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
};

const VARIANT_TONE = {
  neutral: 'border-line bg-surface-muted text-ink-muted',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  search: 'border-line bg-surface-muted text-ink-muted',
  info: 'border-maroon-100 bg-maroon-50/70 text-pup-maroon',
  warning: 'border-[#F0DDB0] bg-[#FFFBEB] text-[#B45309]',
};

const DEFAULT_ICON_BY_VARIANT = {
  neutral: 'inbox',
  success: 'check',
  search: 'search',
  info: 'info',
  warning: 'info',
};

const SURFACE_CLASSES = {
  subtle: 'rounded-xl border border-line bg-surface-muted/40 px-6 py-9 sm:px-8',
  card: 'card px-6 py-10 sm:px-10 sm:py-12',
  plain: 'px-2 py-2',
};

function resolveIcon(icon, variant, compact) {
  if (icon === false || icon === null) return null;
  const svgSize = compact ? 'h-5 w-5' : 'h-6 w-6';
  const stroke = variant === 'success' ? 2.2 : 1.8;
  if (typeof icon === 'string' || icon === undefined) {
    const key = (typeof icon === 'string' && ICONS[icon]) ? icon : (DEFAULT_ICON_BY_VARIANT[variant] ?? 'inbox');
    return (
      <svg viewBox="0 0 24 24" className={svgSize} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        {ICONS[key]}
      </svg>
    );
  }
  return icon;
}

/**
 * Shared empty-state frame modeled after CCMS's "No Unusual Delays Found" layout:
 * centered semantic icon badge, clear heading, explanatory description, optional supporting
 * metadata pill, and optional permission-aware action.
 */
export default function EmptyState({
  variant = 'neutral',
  icon,
  title,
  description,
  supportingInfo = null,
  action = null,
  actionLabel = null,
  onAction = null,
  actionHref = null,
  actionVariant = 'secondary',
  size = 'default',
  surface = 'subtle',
  iconTestId,
  titleTestId,
  descriptionTestId,
  supportTestId,
  className = '',
  children,
  ...props
}) {
  const compact = size === 'compact';
  const badgeTone = VARIANT_TONE[variant] ?? VARIANT_TONE.neutral;
  const surfaceClass = SURFACE_CLASSES[surface] ?? SURFACE_CLASSES.subtle;
  const iconNode = resolveIcon(icon, variant, compact);
  const body = description ?? children;
  const actionBtnClass = actionVariant === 'primary' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm';

  const renderedAction = action ?? (actionLabel
    ? actionHref
      ? <Link href={actionHref} className={actionBtnClass}>{actionLabel}</Link>
      : onAction
        ? <button type="button" onClick={onAction} className={actionBtnClass}>{actionLabel}</button>
        : null
    : null);

  return (
    <div className={`${surfaceClass} ${className}`.trim()} {...props}>
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center text-center">
        {iconNode ? (
          <div
            aria-hidden="true"
            data-testid={iconTestId}
            className={`mx-auto flex items-center justify-center border ${badgeTone} ${
              compact ? 'mb-3 h-10 w-10 rounded-xl' : 'mb-4 h-12 w-12 rounded-2xl'
            }`}
          >
            {iconNode}
          </div>
        ) : null}

        {title ? (
          <h3
            data-testid={titleTestId}
            className={`font-sans font-semibold text-ink ${
              compact ? 'text-[13px] leading-snug sm:text-sm' : 'text-base leading-snug sm:text-lg'
            }`}
          >
            {title}
          </h3>
        ) : null}

        {body ? (
          <div
            data-testid={descriptionTestId}
            className={`font-sans leading-relaxed text-ink-muted ${title ? (compact ? 'mt-1' : 'mt-2') : ''} ${
              compact ? 'text-xs' : 'text-xs sm:text-sm'
            }`.trim()}
          >
            {body}
          </div>
        ) : null}

        {supportingInfo ? (
          <div className={`${compact ? 'mt-3.5' : 'mt-5'} flex max-w-full justify-center`}>
            <div
              data-testid={supportTestId}
              className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-muted px-3.5 py-1.5 font-sans text-xs text-ink-muted"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="8" />
                <path d="M10 9v4M10 6.5h.01" />
              </svg>
              <span>{supportingInfo}</span>
            </div>
          </div>
        ) : null}

        {renderedAction ? (
          <div className={`${compact ? 'mt-4' : 'mt-5'} flex flex-wrap justify-center gap-2`}>
            {renderedAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}
