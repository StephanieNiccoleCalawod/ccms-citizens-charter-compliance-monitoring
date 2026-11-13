/**
 * One figure in a row of summary cards (Dashboard KPIs, Insights pulse, Late-risk counts): small uppercase label, large value,
 * optional note or extra content (a change arrow) underneath. Lay several out with a grid (gap-4) in the page.
 * tone colours the value only for figures whose meaning is the colour's (e.g. 'danger' for high-risk counts); text says the same.
 */
const TONES = {
  default: 'text-maroon-950',
  danger: 'text-red-700',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
};

export default function StatCard({ label, value, note, tone = 'default', testId, className = '', children }) {
  return (
    <div className={`card flex flex-col gap-1 p-4 ${className}`.trim()} data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-bold leading-tight tabular-nums ${TONES[tone] ?? TONES.default}`}>{value}</p>
      {note ? <p className="text-xs text-slate-600">{note}</p> : null}
      {children}
    </div>
  );
}
