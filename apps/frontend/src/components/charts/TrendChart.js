'use client';

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// The one line chart of Insights (the compliance trend and the forecast both use it). Thin 2.5px lines, a quiet grid, no animation,
// a tooltip that lists every series at the hovered period, and, for a forecast, a shaded "projected" area plus a dashed line so
// projected values are never mistaken for history (shape, not only colour).

/** Series colours: the CCCMS maroon for what happened, a dark gold (passes 3:1 on white) for what is projected. */
export const SERIES_COLORS = Object.freeze({ actual: '#800000', projected: '#a37400' });

function TrendTooltip({ active, payload, label, series, unit }) {
  if (!active || !payload?.length) return null;
  const rows = series.map((s) => ({ s, value: payload.find((p) => p.dataKey === s.key)?.value })).filter((r) => r.value !== null && r.value !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-md">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      {rows.map(({ s, value }) => (
        <p key={s.key} className="mt-1 flex items-center gap-2 text-slate-900">
          <svg aria-hidden="true" width="14" height="8" viewBox="0 0 14 8">
            <line x1="1" y1="4" x2="13" y2="4" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
          </svg>
          <span className="font-bold">{value}{unit}</span>
          <span className="text-xs text-slate-500">{s.name}</span>
        </p>
      ))}
    </div>
  );
}

export default function TrendChart({ data, series, xKey = 'label', unit = '%', domain = [50, 100], projectedFrom = null, ariaLabel, height = 260 }) {
  const last = data.at(-1)?.[xKey];
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#EAE3D9" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#52514e' }} tickLine={false} axisLine={{ stroke: '#EAE3D9' }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis domain={domain} width={44} tick={{ fontSize: 11, fill: '#52514e' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}${unit}`} />
          {projectedFrom ? <ReferenceArea x1={projectedFrom} x2={last} fill="#FFDF00" fillOpacity={0.18} ifOverflow="extendDomain" label={{ value: 'Projected', position: 'insideTopRight', fontSize: 11, fill: '#52514e' }} /> : null}
          {projectedFrom ? <ReferenceLine x={projectedFrom} stroke="#a37400" strokeDasharray="2 3" /> : null}
          <Tooltip content={<TrendTooltip series={series} unit={unit} />} cursor={{ stroke: '#c3c2b7' }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              dot={s.dots === false ? false : { r: 3.5, stroke: '#ffffff', strokeWidth: 2, fill: s.color }}
              activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
