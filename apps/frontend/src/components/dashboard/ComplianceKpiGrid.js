const n = (value) => (value === null || value === undefined ? '-' : Number(value).toLocaleString('en-PH'));

/** The change since the previous period, with an arrow and words (never colour alone). */
export function Delta({ change, suffix = '' }) {
  if (change === null || change === undefined) return <span className="text-xs text-slate-500">No earlier period to compare</span>;
  const same = change === 0;
  const up = change > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${same ? 'text-slate-600' : up ? 'text-emerald-700' : 'text-red-700'}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={same ? 'M5 12h14' : up ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
      </svg>
      {same ? 'No change' : `${up ? 'Up' : 'Down'} ${Math.abs(change)}${suffix}`}
      <span className="font-normal text-slate-500">vs previous period</span>
    </span>
  );
}

function Kpi({ k }) {
  const change = k.value !== null && k.previous !== null ? Math.round((k.value - k.previous) * 10) / 10 : null;
  return (
    <div className="card flex flex-col justify-between gap-1 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{k.label}</p>
      <p className="text-2xl font-bold leading-tight text-maroon-950">{n(k.value)}{k.value !== null ? k.unit : ''}</p>
      <Delta change={change} suffix={k.unit === '%' ? ' points' : ''} />
    </div>
  );
}

/** Section 2: the four indicators share one row on desktop, while narrow screens retain a readable stacked layout. */
export default function ComplianceKpiGrid({ kpis }) {
  if (kpis.length === 0) {
    return (
      <div className="card p-4" data-testid="pulse-kpis-empty">
        <p className="text-sm text-slate-600">No indicators yet.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-4" data-testid="kpi-grid">
      {kpis.slice(0, 4).map((k) => (
        <Kpi key={k.key} k={k} />
      ))}
    </div>
  );
}
