// A message bar. Success, info, warning and error variants share one layout.
const VARIANTS = {
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', button: '' },
  error: { box: 'border-red-200 bg-red-50 text-red-800', button: 'text-red-700' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', button: '' },
  info: { box: 'border-slate-200 bg-white text-slate-700', button: '' },
};

export default function StatusBanner({ variant = 'info', message, onDismiss, dismissLabel = 'Dismiss', dismissAriaLabel, className = '', children }) {
  const content = children ?? message;
  if (!content) return null;
  const v = VARIANTS[variant] ?? VARIANTS.info;
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${v.box} ${className}`}>
      <span>{content}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className={`font-semibold hover:underline ${v.button}`} aria-label={dismissAriaLabel}>
          {dismissLabel}
        </button>
      ) : null}
    </div>
  );
}
