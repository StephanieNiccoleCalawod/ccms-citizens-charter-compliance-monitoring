import { seededHistoryDisclosure } from '../../lib/ui/seeded-history.js';

/** Section 6: collapsed by default and visually quiet, so it never competes with the figures. */
export default function AboutAnalyticsPanel({ completedRows = null, lateCases = null }) {
  const disclosure = seededHistoryDisclosure();
  return (
    <details className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-slate-700" data-testid="insights-about">
      <summary className="cursor-pointer font-semibold text-slate-800">About these analytics</summary>
      <dl className="mt-3 space-y-2">
        <div><dt className="inline font-semibold text-slate-900">On-time compliance: </dt><dd className="inline">the share of transactions finished within their Citizen&rsquo;s Charter time limit in a period. Higher is better.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Expected request volume: </dt><dd className="inline">the number of requests expected over the next 5 working days, shown with a likely range.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Deadline risk: </dt><dd className="inline">how likely each open transaction is to miss its deadline, grouped as Low, Medium, and High. It shows where to follow up first. It is an estimate, not a record of transactions that are already overdue.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Office performance: </dt><dd className="inline">on-time compliance for each office and month. Darker cells mean higher compliance; a hatched cell has no data.</dd></div>
        <div>
          <dt className="inline font-semibold text-slate-900">Data limitations: </dt>
          <dd className="inline">
            figures cover only the offices you are allowed to see and refresh every minute
            {completedRows != null ? ` (${Number(completedRows).toLocaleString('en-PH')} completed, ${Number(lateCases ?? 0).toLocaleString('en-PH')} late in the period window).` : '.'}
          </dd>
        </div>
        {/* K16: the single disclosure line about the fictional history (period and go-live date from settings). */}
        {disclosure ? <div data-testid="seeded-history-disclosure"><dd>{disclosure}</dd></div> : null}
      </dl>
    </details>
  );
}
