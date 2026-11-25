'use client';

import ChartCard from '../charts/ChartCard.js';
import Heatmap, { HeatLegend } from '../charts/Heatmap.js';

/** Section 5, full width: compliance by office (rows) and month (columns), with the colour legend. */
export default function ComplianceHeatmap({ heatmap, scope }) {
  return (
    <ChartCard
      id="heatmap"
      title="On-Time Compliance by Office"
      calculation={heatmap.calculation ?? null}
      calculationSubject="on-time compliance by office"
      description={scope.kind === 'office' ? 'Your office, by month.' : 'Each row is an office and each column is a month. Hover over or select a cell to see its value.'}
      empty={heatmap.rows.length === 0 || heatmap.periods.length === 0}
      emptyMessage="No office data to show yet."
    >
      <div className="mb-3"><HeatLegend /></div>
      <Heatmap periods={heatmap.periods} rows={heatmap.rows} caption="On-time compliance by office and month" />
    </ChartCard>
  );
}
