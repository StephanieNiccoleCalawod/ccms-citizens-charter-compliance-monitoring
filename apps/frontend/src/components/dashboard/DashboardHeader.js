import { updatedLabel } from '../../lib/ui/analytics.js';
import StatusBadge from '../ui/StatusBadge.js';

/** Section 1: which offices the figures cover, when they were last refreshed (TT10 12-hour time) and that they refresh by themselves. */
export default function DashboardHeader({ scope, lastUpdated, refreshing, sample }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2" data-testid="dashboard-status">
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-900">Scope:</span> {scope.kind === 'office' ? 'your office only' : 'the whole campus'}
        {sample ? <StatusBadge variant="accent" className="ml-2">Sample data</StatusBadge> : null}
      </p>
      <p className="inline-flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-pup-maroon ${refreshing ? 'animate-pulse' : 'opacity-40'}`} />
        <span data-testid="insights-updated">{updatedLabel(lastUpdated)}</span>
        <span className="text-xs text-slate-500">{refreshing ? 'Refreshing…' : 'Refreshes every minute'}</span>
      </p>
    </div>
  );
}
