'use client';

import ChartCard, { LegendItem } from '../charts/ChartCard.js';
import TrendChart, { SERIES_COLORS } from '../charts/TrendChart.js';

const CHARTER_BENCHMARK = 95;
const fmt = (v) => (v === null || v === undefined ? '-' : `${v}%`);

function ChangeBadge({ change }) {
  if (change === null || change === undefined) return null;
  const num = Number(change);
  if (!Number.isFinite(num)) return null;
  if (num < 0) {
    return (
      <span
        data-testid="trend-delta-badge"
        className="inline-flex items-center rounded-md border border-[#F3C5C5] bg-[#FDF2F2] px-2 py-0.5 font-mono text-[11px] font-bold text-[#800000]"
      >
        &darr; {Math.abs(num)} points vs previous period
      </span>
    );
  }
  if (num > 0) {
    return (
      <span
        data-testid="trend-delta-badge"
        className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700"
      >
        &uarr; {num} points vs previous period
      </span>
    );
  }
  return (
    <span
      data-testid="trend-delta-badge"
      className="inline-flex items-center rounded-md border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-mono text-[11px] font-bold text-[#475569]"
    >
      No change vs previous period
    </span>
  );
}

/** Section 3, left: monthly compliance line chart against the 95% Citizen's Charter benchmark. */
export default function ComplianceTrendChart({ pulse }) {
  const trend = pulse?.trend ?? [];
  const empty = trend.filter((p) => p.value !== null).length === 0;
  const missingPeriods = trend.filter((p) => p.value === null);

  const baselineNote = missingPeriods.length === 1
    ? `${missingPeriods[0].label} has no completed transactions on record`
    : missingPeriods.length > 1
      ? `${missingPeriods.map((p) => p.label).join(', ')} have no completed transactions on record`
      : `All ${trend.length} months have completed transactions on record`;

  return (
    <ChartCard
      id="pulse"
      title="Compliance Trend"
      badge={<ChangeBadge change={pulse.change} />}
      description={
        pulse.current !== null ? (
          <>
            Currently <span className="font-bold text-[#202938]">{pulse.current}%</span>, tracked monthly against {CHARTER_BENCHMARK}% Citizen&rsquo;s Charter benchmark.
          </>
        ) : (
          `Share of transactions finished within their charter deadline, tracked against ${CHARTER_BENCHMARK}% Citizen's Charter benchmark.`
        )
      }
      legend={(
        <>
          <LegendItem color={SERIES_COLORS.actual} label="Monthly Compliance" />
          <LegendItem color={SERIES_COLORS.benchmark} label="95% Charter Target" dashed />
        </>
      )}
      empty={empty}
      emptyMessage="There is no compliance history to show yet."
      table={{
        caption: 'Compliance by month',
        columns: [
          { key: 'label', label: 'Month' },
          { key: 'value', label: 'Compliance', align: 'right' },
        ],
        rows: trend.map((p) => ({ label: p.label, value: fmt(p.value) })),
      }}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span data-testid="trend-baseline-note">{baselineNote}</span>
          <a
            href="#heatmap"
            data-testid="compare-by-office-link"
            className="inline-flex min-h-6 items-center font-semibold text-[#800000] hover:underline"
          >
            Compare by office &rarr;
          </a>
        </div>
      )}
    >
      <TrendChart
        data={trend}
        series={[{ key: 'value', name: 'Monthly Compliance', color: SERIES_COLORS.actual }]}
        benchmark={CHARTER_BENCHMARK}
        areaFill
        ariaLabel={`Line chart of monthly compliance against ${CHARTER_BENCHMARK}% benchmark. Latest value ${fmt(pulse.current)}.`}
      />
    </ChartCard>
  );
}
