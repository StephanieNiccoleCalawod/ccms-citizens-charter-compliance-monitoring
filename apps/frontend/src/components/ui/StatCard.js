import CalculationInfo from '../analytics/CalculationInfo.js';

/**
 * One figure in a row of summary cards (Dashboard KPIs, Insights pulse, Late-risk counts): small uppercase label, large value,
 * optional note or extra content (a change arrow) underneath. Lay several out with a grid (gap-4) in the page.
 * tone colours the value only for figures whose meaning is the colour's (e.g. 'danger' for high-risk counts); text says the same.
 */
const TONES = {
  default: 'text-ink',
  brand: 'text-pup-maroon',
  danger: 'text-red-700',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
};

export default function StatCard({ label, value, note, tone = 'default', icon = null, testId, className = '', calculation, children }) {
  // S8-46: pass `calculation` (even null) to add the "How is this calculated?" control beside the label.
  const info = calculation !== undefined ? <CalculationInfo calculation={calculation} subject={String(label).toLowerCase()} testId={testId ? `${testId}-calc` : 'stat-calc'} className="-my-1 -mr-1" /> : null;
  return (
    <div className={`card flex flex-col gap-1 p-4 ${className}`.trim()} data-testid={testId}>
      {icon ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
            <p className={`text-2xl font-bold leading-tight tabular-nums ${TONES[tone] ?? TONES.default}`}>{value}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">{info}{icon}</div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
            {info}
          </div>
          <p className={`text-2xl font-bold leading-tight tabular-nums ${TONES[tone] ?? TONES.default}`}>{value}</p>
        </>
      )}
      {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
      {children}
    </div>
  );
}
