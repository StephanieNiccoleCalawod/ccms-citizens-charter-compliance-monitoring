'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Late-risk distribution as ranked horizontal bars, one per category in severity order. Colours are the fixed status palette and are
// never the only cue: every bar has its name on the axis, its count printed at its end, and an icon in the list below the chart.

export const RISK_STYLE = Object.freeze({
  low: { color: '#0ca30c', icon: 'M5 12l4 4 10-10', name: 'check' },
  medium: { color: '#fab219', icon: 'M12 8v5M12 16.5h.01', name: 'notice' },
  high: { color: '#ec835a', icon: 'M12 7v6M12 16.5h.01', name: 'warning' },
  critical: { color: '#d03b3b', icon: 'M8 8l8 8M16 8l-8 8', name: 'cross' },
});

export function RiskIcon({ category, className = 'h-4 w-4' }) {
  const style = RISK_STYLE[category];
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke={style.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" strokeWidth="2" />
      <path d={style.icon} />
    </svg>
  );
}

function RiskTooltip({ active, payload }) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <div className="rounded-lg border border-[#EAE3D9] bg-white px-3 py-2 text-sm shadow-md">
      <p className="font-bold text-slate-900">{item.count.toLocaleString('en-PH')} <span className="text-xs font-normal text-slate-500">{item.label} risk</span></p>
      {item.description ? <p className="mt-1 max-w-[16rem] text-xs text-slate-600">{item.description}</p> : null}
    </div>
  );
}

export default function RiskBars({ categories, ariaLabel, height = 220 }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={categories} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke="#EAE3D9" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#52514e' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={64} tick={{ fontSize: 12, fill: '#0b0b0b' }} tickLine={false} axisLine={false} />
          <Tooltip content={<RiskTooltip />} cursor={{ fill: '#FBF8F3' }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false}>
            {categories.map((c) => (
              <Cell key={c.key} fill={RISK_STYLE[c.key].color} />
            ))}
            <LabelList dataKey="count" position="right" fontSize={12} fill="#0b0b0b" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
