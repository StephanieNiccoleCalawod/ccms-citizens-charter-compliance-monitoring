'use client';

import ChartCard, { LegendItem } from '../charts/ChartCard.js';
import TrendChart, { SERIES_COLORS } from '../charts/TrendChart.js';
import { Delta } from './ComplianceKpiGrid.js';

const fmt = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/** Section 3, left: compliance by month. */
export default function ComplianceTrendChart({ pulse }) {
  const empty = pulse.trend.filter((p) => p.value !== null).length === 0;
  return (
    <ChartCard
      id="pulse"
      title="Compliance trend"
      description={pulse.current !== null ? `Currently ${pulse.current}%, by month.` : 'Share of transactions finished within their charter deadline, by month.'}
      legend={<LegendItem color={SERIES_COLORS.actual} label="Compliance" />}
      empty={empty}
      emptyMessage="There is no compliance history to show yet."
      table={{ caption: 'Compliance by month', columns: [{ key: 'label', label: 'Month' }, { key: 'value', label: 'Compliance', align: 'right' }], rows: pulse.trend.map((p) => ({ label: p.label, value: fmt(p.value) })) }}
    >
      <div className="mb-2"><Delta change={pulse.change} suffix=" points" /></div>
      <TrendChart data={pulse.trend} series={[{ key: 'value', name: 'Compliance', color: SERIES_COLORS.actual }]} ariaLabel={`Line chart of monthly compliance. Latest value ${fmt(pulse.current)}.`} />
    </ChartCard>
  );
}
