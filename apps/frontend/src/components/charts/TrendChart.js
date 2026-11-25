'use client';

import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// The one line chart of Insights (the compliance trend and the forecast both use it). Thin 2.5px lines, a quiet grid, no animation,
// a tooltip that lists every series at the hovered period, optional 95% Charter target reference line and subtle area fill,
// and, for a forecast, a shaded "projected" area plus a dashed line.

/** Series colours: the CCCMS maroon for what happened, a dark gold (passes 3:1 on white) for what is projected, and emerald for benchmark. */
export const SERIES_COLORS = Object.freeze({ actual: '#800000', projected: '#a37400', benchmark: '#16a34a' });

function TrendTooltip({ active, payload, label, series, unit, benchmark }) {
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
      {benchmark != null ? (
        <p className="mt-1 text-[11px] font-medium text-emerald-700">Promised processing time: {benchmark}{unit}</p>
      ) : null}
    </div>
  );
}

export default function TrendChart({
  data,
  series,
  xKey = 'label',
  unit = '%',
  domain = [50, 100],
  projectedFrom = null,
  benchmark = null,
  areaFill = false,
  ariaLabel,
  height = 240,
}) {
  const last = data.at(-1)?.[xKey];
  const primary = series[0];
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          {areaFill && primary ? (
            <defs>
              <linearGradient id="ccmsTrendAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primary.color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={primary.color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
          ) : null}
          <CartesianGrid vertical={false} stroke="#EAE3D9" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#EAE3D9' }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis domain={domain} width={44} tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}${unit}`} />
          {benchmark != null ? (
            <ReferenceLine
              y={benchmark}
              stroke={SERIES_COLORS.benchmark}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
          ) : null}
          {projectedFrom ? <ReferenceArea x1={projectedFrom} x2={last} fill="#FFDF00" fillOpacity={0.18} ifOverflow="extendDomain" label={{ value: 'Projected', position: 'insideTopRight', fontSize: 11, fill: '#52514e' }} /> : null}
          {projectedFrom ? <ReferenceLine x={projectedFrom} stroke="#a37400" strokeDasharray="2 3" /> : null}
          <Tooltip content={<TrendTooltip series={series} unit={unit} benchmark={benchmark} />} cursor={{ stroke: '#c3c2b7' }} />
          {areaFill && primary ? (
            <Area
              type="monotone"
              dataKey={primary.key}
              stroke="none"
              fill="url(#ccmsTrendAreaFill)"
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
          ) : null}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              dot={s.dots === false ? false : { r: 4, stroke: s.color, strokeWidth: 2.5, fill: '#ffffff' }}
              activeDot={{ r: 5.5, stroke: '#ffffff', strokeWidth: 2, fill: s.color }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
