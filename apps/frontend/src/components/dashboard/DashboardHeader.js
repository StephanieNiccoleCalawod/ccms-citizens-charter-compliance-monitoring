import { updatedLabel } from '../../lib/ui/analytics.js';

/** Section 1: which offices the figures cover, when they were last refreshed (TT10 12-hour time), and auto-refresh status. */
export default function DashboardHeader({ scope, scopeLabel = '', lastUpdated, refreshing }) {
  const scopeText = scopeLabel || (scope.kind === 'office' ? 'your office only' : 'the whole campus');
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2" data-testid="dashboard-status">
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-900">Scope:</span> {scopeText}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="inline-flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-pup-maroon ${refreshing ? 'animate-pulse' : 'opacity-40'}`} />
          <span data-testid="insights-updated">{updatedLabel(lastUpdated)}</span>
          <span className="text-xs text-slate-500">{refreshing ? 'Refreshing…' : 'Refreshes every minute'}</span>
        </p>
        <a href="#charter" className="text-xs font-semibold text-pup-maroon underline" data-testid="dashboard-charter-link">
          Charter check &amp; cell drilldown
        </a>
      </div>
    </div>
  );
}
