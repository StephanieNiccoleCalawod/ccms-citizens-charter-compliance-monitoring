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
      <span data-testid="trend-delta-badge" className="font-mono text-xs font-bold text-[#800000]">
        &darr; {Math.abs(num)} vs prior
      </span>
    );
  }
  if (num > 0) {
    return (
      <span data-testid="trend-delta-badge" className="font-mono text-xs font-bold text-emerald-700">
        &uarr; {num} vs prior
      </span>
    );
  }
  return (
    <span data-testid="trend-delta-badge" className="font-mono text-xs font-bold text-[#64748B]">
      No change vs prior
    </span>
  );
}

/** One of the three stat tiles above the chart: Period Compliance, PUP Charter Target, On-Time Completed. */
function Tile({ label, value, valueClassName = 'text-[#202938]', children }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${valueClassName}`}>{value}</p>
      {children ? <div className="mt-0.5">{children}</div> : null}
    </div>
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

  // On-time completed count: the raw count isn't in this pulse payload, only the rate and the completed total, so the
  // count is the two already-shown figures multiplied together (same derivation style as the risk percentages elsewhere).
  const completedTotal = pulse.results ?? null;
  const onTimeCompleted = completedTotal !== null && pulse.current !== null ? Math.round(completedTotal * (pulse.current / 100)) : null;

  return (
    <ChartCard
      id="pulse"
      title="Citizen's Charter On-Time Compliance"
      badge={(
        <span className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
          Period-Based
        </span>
      )}
      calculation={pulse.calculation ?? null}
      calculationSubject="the compliance trend"
      description={`Completed within official Citizen's Charter turnaround standards, tracked against the ${CHARTER_BENCHMARK}% benchmark.`}
      legend={(
        <>
          <LegendItem color={SERIES_COLORS.actual} label="Monthly Compliance" />
          <LegendItem color={SERIES_COLORS.benchmark} label="95% Charter Target" dashed />
        </>
      )}
      empty={empty}
      emptyIcon="chart"
      emptyTitle="No Compliance History Yet"
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
            href="#charter"
            data-testid="compare-by-office-link"
            className="font-semibold text-[#800000] hover:underline"
          >
            View Service Charter Breakdown &rarr;
          </a>
        </div>
      )}
    >
      {!empty ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Tile label="Period Compliance" value={fmt(pulse.current)}>
            <ChangeBadge change={pulse.change} />
          </Tile>
          <Tile label="PUP Charter Target" value={`${CHARTER_BENCHMARK}%`}>
            <span className="font-sans text-xs text-[#64748B]">Citizen&rsquo;s Charter benchmark</span>
          </Tile>
          <Tile label="On-Time Completed" value={onTimeCompleted !== null ? onTimeCompleted.toLocaleString('en-PH') : '-'}>
            <span className="font-sans text-xs text-[#64748B]">{completedTotal !== null ? `of ${completedTotal.toLocaleString('en-PH')} completed` : ''}</span>
          </Tile>
        </div>
      ) : null}
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
