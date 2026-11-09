const STYLE = {
  positive: { label: 'Positive', icon: 'M5 12l4 4 10-10', tone: 'text-emerald-700' },
  warning: { label: 'Warning', icon: 'M12 7v6M12 16.5h.01', tone: 'text-amber-700' },
  attention: { label: 'Needs attention', icon: 'M12 8v5M12 16.5h.01', tone: 'text-maroon-800' },
};

/** Section 4, right: short observations. Each has an icon and a word for its kind; the card stays white and quiet. */
export default function KeyInsightsPanel({ insights, sample }) {
  return (
    <section aria-labelledby="key-insights-title" className="card flex h-full flex-col p-5">
      <h3 id="key-insights-title" className="title-card">Key insights</h3>
      <p className="mt-1 text-sm text-slate-600">{sample ? 'Sample observations, not verified findings.' : 'What stands out in the figures.'}</p>
      {insights.length === 0 ? (
        <div role="status" data-testid="insights-sentences-empty" className="mt-4 flex-1 rounded-xl border border-dashed border-[#EAE3D9] bg-[#FBF8F3] px-4 py-10 text-center text-sm text-slate-600">
          No observations to report yet.
        </div>
      ) : (
        <ul className="mt-4 flex-1 divide-y divide-[#EAE3D9]">
          {insights.map((s) => {
            const style = STYLE[s.kind] ?? STYLE.attention;
            return (
              <li key={s.id} className="flex items-start gap-3 py-3 text-sm text-slate-800 first:pt-0 last:pb-0">
                <svg aria-hidden="true" viewBox="0 0 24 24" className={`mt-0.5 h-5 w-5 shrink-0 ${style.tone}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" strokeWidth="2" />
                  <path d={style.icon} />
                </svg>
                <span>
                  <span className={`block text-xs font-bold uppercase tracking-wide ${style.tone}`}>{style.label}</span>
                  {s.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
