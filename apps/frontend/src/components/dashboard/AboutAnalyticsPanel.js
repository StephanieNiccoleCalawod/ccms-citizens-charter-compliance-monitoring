/** Section 6: collapsed by default and visually quiet, so it never competes with the figures. */
export default function AboutAnalyticsPanel({ sample }) {
  return (
    <details className="rounded-xl border border-[#EAE3D9] bg-[#FBF8F3] px-4 py-3 text-sm text-slate-700" data-testid="insights-about">
      <summary className="cursor-pointer font-semibold text-slate-800">About these analytics</summary>
      <dl className="mt-3 space-y-2">
        <div><dt className="inline font-semibold text-slate-900">Compliance: </dt><dd className="inline">the share of transactions finished within their charter deadline in a period. Higher is better.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Forecast: </dt><dd className="inline">where compliance may go if recent trends continue. It is an estimate, not a promise, and it can change as new transactions arrive.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Late risk: </dt><dd className="inline">how likely each open transaction is to miss its deadline, grouped as Low, Medium, High and Critical. It points to where to follow up first.</dd></div>
        <div><dt className="inline font-semibold text-slate-900">Heatmap: </dt><dd className="inline">compliance for each office and month. Darker cells mean higher compliance; a hatched cell has no data.</dd></div>
        <div>
          <dt className="inline font-semibold text-slate-900">Data limitations: </dt>
          <dd className="inline">
            figures cover only the offices you are allowed to see and refresh every minute.
            {sample ? ' Development data is illustrative until the Sprint 6 analytics services are available: the numbers are samples, not real measurements, and the sentences are not verified findings.' : ''}
          </dd>
        </div>
      </dl>
    </details>
  );
}
