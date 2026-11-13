'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// CC038 request volume forecast chart.
// Shows the last 20 working days of actual counts (maroon) and the next 5 estimated days (gold),
// with a shaded 10th–90th percentile range. The vertical reference line separates history from forecast.
// A working-day X-axis means no weekend or holiday dates appear.

const ACTUAL_COLOR    = '#800000'; // CCCMS maroon
const FORECAST_COLOR  = '#a37400'; // dark gold (3:1 on white)
const RANGE_COLOR     = '#FFDF00'; // gold fill for the forecast range
const GRID_COLOR      = '#EAE3D9';
const TICK_COLOR      = '#52514e';

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const find = (key) => payload.find((p) => p.dataKey === key)?.value;
  const actual   = find('actual');
  const forecast = find('forecast');
  const lower    = find('lower');
  const upper    = find('upper');
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-md">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      {actual   != null && <p className="mt-1 text-slate-900"><span className="font-bold">{actual}</span> <span className="text-xs text-slate-500">requests (actual)</span></p>}
      {forecast != null && (
        <>
          <p className="mt-1 text-slate-900"><span className="font-bold">{forecast}</span> <span className="text-xs text-slate-500">estimated</span></p>
          {lower != null && upper != null && <p className="text-xs text-slate-500">Range: {lower}–{upper}</p>}
        </>
      )}
    </div>
  );
}

/**
 * @param {{
 *   data: Array<{ date: string, label: string, actual?: number, forecast?: number, lower?: number, upper?: number }>,
 *   firstForecastDate: string|null,
 *   height?: number,
 * }} props
 */
export default function RequestForecastChart({ data, firstForecastDate, height = 280 }) {
  if (!data?.length) return <p className="py-10 text-center text-sm text-slate-500">No data to chart.</p>;

  return (
    <div role="img" aria-label="Request volume forecast chart showing historical counts and 5-day estimate" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: TICK_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            width={40}
            tick={{ fontSize: 11, fill: TICK_COLOR }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v) => v}
          />

          {/* Shaded forecast range (lower→upper) */}
          <Area
            dataKey="upper"
            stroke="none"
            fill={RANGE_COLOR}
            fillOpacity={0.35}
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            dataKey="lower"
            stroke="none"
            fill="#ffffff"
            fillOpacity={1}
            isAnimationActive={false}
            legendType="none"
          />

          {/* Forecast/history separator */}
          {firstForecastDate && (
            <ReferenceLine x={firstForecastDate} stroke={FORECAST_COLOR} strokeDasharray="3 3" />
          )}

          {/* Actual history line */}
          <Line
            dataKey="actual"
            name="Actual"
            stroke={ACTUAL_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* Estimated forecast line */}
          <Line
            dataKey="forecast"
            name="Estimated"
            stroke={FORECAST_COLOR}
            strokeWidth={2.5}
            strokeDasharray="5 4"
            dot={{ r: 3, fill: FORECAST_COLOR }}
            isAnimationActive={false}
            connectNulls={false}
          />

          <Tooltip content={<ForecastTooltip />} cursor={{ stroke: '#c3c2b7' }} />
          <Legend
            formatter={(value) => <span className="text-xs text-slate-700">{value}</span>}
            iconType="plainline"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
