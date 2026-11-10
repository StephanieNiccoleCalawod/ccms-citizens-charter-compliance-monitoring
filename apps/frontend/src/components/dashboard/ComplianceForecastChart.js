'use client';

import ChartCard, { LegendItem } from '../charts/ChartCard.js';
import TrendChart, { SERIES_COLORS } from '../charts/TrendChart.js';

const fmt = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/** Section 3, right: past months solid, projected months dashed and shaded. */
export default function ComplianceForecastChart({ forecast }) {
  return (
    <ChartCard
      id="forecast"
      title="Forecast"
      description={forecast.note || 'Past months are a solid line. Projected months are dashed and shaded.'}
      legend={
        <>
          <LegendItem color={SERIES_COLORS.actual} label="Actual" />
          <LegendItem color={SERIES_COLORS.projected} label="Projected" dashed />
        </>
      }
      empty={forecast.points.length === 0}
      emptyMessage="There is not enough history to project compliance yet."
      table={{ caption: 'Actual and projected compliance by month', columns: [{ key: 'label', label: 'Month' }, { key: 'actual', label: 'Actual', align: 'right' }, { key: 'forecast', label: 'Projected', align: 'right' }], rows: forecast.points.map((p) => ({ label: p.label, actual: fmt(p.actual), forecast: fmt(p.forecast) })) }}
    >
      <div className="mb-2 h-4" aria-hidden="true" />
      <TrendChart
        data={forecast.points}
        series={[
          { key: 'actual', name: 'Actual', color: SERIES_COLORS.actual },
          { key: 'forecast', name: 'Projected', color: SERIES_COLORS.projected, dashed: true },
        ]}
        projectedFrom={forecast.projectedFrom}
        ariaLabel={`Line chart of actual compliance followed by projected compliance${forecast.projectedFrom ? ` from ${forecast.projectedFrom}` : ''}.`}
      />
    </ChartCard>
  );
}
