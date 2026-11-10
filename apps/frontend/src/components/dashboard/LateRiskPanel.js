'use client';

import ChartCard from '../charts/ChartCard.js';
import RiskBars, { RiskIcon } from '../charts/RiskBars.js';

const n = (value) => Number(value).toLocaleString('en-PH');

/** Section 4, left: open transactions by how likely they are to be late, as bars with counts and plain descriptions. */
export default function LateRiskPanel({ lateRisk }) {
  const { categories, total } = lateRisk;
  return (
    <ChartCard
      id="risk"
      title="Late-risk monitoring"
      description={`${n(total)} open transactions, grouped by how likely they are to miss their deadline.`}
      empty={categories.length === 0}
      emptyMessage="No open transactions to assess."
      table={{ caption: 'Open transactions by late-risk category', columns: [{ key: 'label', label: 'Risk' }, { key: 'count', label: 'Open transactions', align: 'right' }, { key: 'description', label: 'Meaning' }], rows: categories.map((c) => ({ label: c.label, count: n(c.count), description: c.description })) }}
    >
      <RiskBars categories={categories} height={200} ariaLabel={`Bar chart of open transactions by late risk: ${categories.map((c) => `${c.label} ${c.count}`).join(', ')}.`} />
      <ul className="mt-3 space-y-2">
        {categories.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            <RiskIcon category={c.key} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold text-slate-900">{c.label}: {n(c.count)}</span>
              {c.description ? <span className="text-slate-600"> · {c.description}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
