'use client';

import { useMemo, useRef, useState } from 'react';
import { getInsightsCell } from '../../lib/api/insights.js';
import {
  MIN_CELL_COMPLETED,
  SERVICE_RISK_LEGEND,
  SERVICE_RISK_STYLES,
  buildServiceLateRateModel,
  filterNoActivityServices,
} from '../../lib/ui/insights.js';
import { notify } from '../../lib/ui/notify.js';
import SearchInput from '../forms/SearchInput.js';
import EmptyState from '../ui/EmptyState.js';
import ServiceCellDetail from './ServiceCellDetail.js';

/**
 * Late Rate by Office & Service (CCCMS Dashboard office monitoring grid):
 * 3-column office cards with status badges (N flagged / Low volume / On track),
 * full-width semantic service bars, All Active / Flagged High Late Rate / Too Few to Judge filters with counts,
 * weekly cell drilldown, and a searchable collapsible section for services with no transactions this period.
 */
export default function ServiceLateRateMatrix({
  overview,
  period = 'monthly',
  offices = [],
  services = [],
  servicesLoaded = true,
  names = {},
  scope = { kind: 'campus', officeId: null },
}) {
  const [filter, setFilter] = useState('all');
  const [inactiveOpen, setInactiveOpen] = useState(true);
  const [inactiveQuery, setInactiveQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState(null);
  const [cellData, setCellData] = useState(null);
  const reqSeqRef = useRef(0);

  const minCompleted = Number(overview?.min_cell_completed) || MIN_CELL_COMPLETED;

  const model = useMemo(
    () => buildServiceLateRateModel({
      heatmap: overview?.heatmap ?? [],
      offices,
      services,
      names,
      scope,
      filter,
      minCompleted,
    }),
    [overview?.heatmap, offices, services, names, scope, filter, minCompleted],
  );

  const filteredNoActivity = useMemo(
    () => filterNoActivityServices(model.noActivityServices, inactiveQuery),
    [model.noActivityServices, inactiveQuery],
  );

  const inactiveOfficeSummary = useMemo(() => {
    const distinct = [...new Set(model.noActivityServices.map((s) => s.office_name).filter(Boolean))];
    if (distinct.length === 0) return '';
    if (distinct.length <= 3) return distinct.join(', ');
    return `${distinct.slice(0, 3).join(', ')} & ${distinct.length - 3} more`;
  }, [model.noActivityServices]);

  const filterButtons = [
    { value: 'all', label: `All Active (${model.counts.all})` },
    { value: 'flagged', label: `Flagged Services (${model.counts.flagged})`, flagged: true },
    { value: 'too_few', label: `Too Few to Judge (${model.counts.tooFew})` },
  ];

  async function openCell(card) {
    const seq = ++reqSeqRef.current;
    setSelectedCell(card);
    setCellData(null);
    try {
      const detail = await getInsightsCell({ officeId: card.office_id, serviceId: card.service_id, period });
      if (seq === reqSeqRef.current) setCellData(detail);
    } catch (failure) {
      if (seq === reqSeqRef.current) {
        setCellData(null);
        notify.error(failure?.message || 'Detail could not be loaded.');
      }
    }
  }

  const emptyMessage = filter === 'flagged'
    ? 'No flagged services in this period.'
    : filter === 'too_few'
      ? 'No services with insufficient completed transactions in this period.'
      : 'No completed transactions in this period.';

  return (
    <section
      aria-labelledby="service-heatmap-title"
      id="service-heatmap"
      className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-sm"
      data-testid="insights-heatmap"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3 id="service-heatmap-title" className="font-serif text-xl font-normal leading-tight text-[#202938] sm:text-2xl">
              Late Rate by Office &amp; Service
            </h3>
            <p className="mt-1 font-sans text-sm text-[#64748B]">
              Services with fewer than {minCompleted} completed transactions are marked as{' '}
              <span className="font-semibold text-[#202938]">Too few to judge</span>. Select a service to see its weekly breakdown and late transactions.
            </p>
          </div>

          <div
            role="group"
            aria-label="Filter services by late rate status"
            className="flex max-w-full shrink-0 flex-wrap items-center gap-2 overflow-x-auto"
            data-testid="heatmap-status-filter"
          >
            {filterButtons.map((opt) => {
              const selected = filter === opt.value;
              const unselectedStyle = opt.flagged && model.counts.flagged > 0
                ? 'border-[#F3C5C5] bg-[#FDF2F2] text-[#800000] hover:border-[#800000] hover:bg-[#F8EEEE]'
                : 'border-[#E2E8F0] bg-[#F4F5F8] text-[#64748B] hover:border-slate-300 hover:bg-white hover:text-[#202938]';
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(opt.value)}
                  data-testid={`heatmap-filter-${opt.value}`}
                  className={`cursor-pointer whitespace-nowrap rounded-lg border px-3 py-1.5 font-sans text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-1 ${selected
                      ? 'border-[#800000] bg-[#800000] text-white shadow-xs'
                      : unselectedStyle
                    }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Risk legend" data-testid="service-risk-legend">
          {SERVICE_RISK_LEGEND.map((item) => (
            <li key={item.key} className="inline-flex items-center gap-2 font-sans text-xs text-[#64748B]">
              <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-xs border ${item.swatch}`} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>

        {model.officeRows.length === 0 ? (
          <EmptyState className="mt-5" data-testid="service-matrix-empty">{emptyMessage}</EmptyState>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="service-office-rows">
            {model.officeRows.map((row) => {
              const hasFlagged = row.flagged_count > 0;
              return (
                <div
                  key={row.office_id}
                  data-testid="service-office-row"
                  data-flagged={hasFlagged ? 'true' : 'false'}
                  className={`flex flex-col rounded-xl border p-4 transition-colors ${hasFlagged ? 'border-[#F3C5C5] bg-[#FFFDFD]' : 'border-[#E2E8F0] bg-white'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2 pb-3">
                    <p className="min-w-0 font-sans text-sm font-bold leading-snug text-[#202938]">{row.office_name}</p>
                    {hasFlagged ? (
                      <span
                        data-testid="office-status-badge"
                        className="inline-flex shrink-0 items-center rounded-md border border-[#F3C5C5] bg-[#F8EEEE] px-2 py-0.5 font-sans text-[11px] font-semibold text-[#800000]"
                      >
                        {row.flagged_count} flagged
                      </span>
                    ) : row.low_volume ? (
                      <span
                        data-testid="office-status-badge"
                        className="inline-flex shrink-0 items-center rounded-md border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-sans text-[11px] font-semibold text-[#64748B]"
                      >
                        Low volume
                      </span>
                    ) : (
                      <span
                        data-testid="office-status-badge"
                        className="inline-flex shrink-0 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-emerald-700"
                      >
                        On track
                      </span>
                    )}
                  </div>

                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
                    {row.cards.map((card) => {
                      const style = SERVICE_RISK_STYLES[card.risk] ?? SERVICE_RISK_STYLES.too_few;
                      const isSelected = selectedCell?.office_id === card.office_id && selectedCell?.service_id === card.service_id;
                      return (
                        <button
                          key={`${card.office_id}-${card.service_id}`}
                          type="button"
                          onClick={() => openCell(card)}
                          data-testid="heat-cell"
                          data-risk={card.risk}
                          title={`${card.service_name} (${card.completed} completed, ${card.late} late)`}
                          aria-label={`${card.service_name} (${card.service_code}): ${card.label}, ${card.completed} completed`}
                          className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-1 ${style.card} ${isSelected ? 'border-[#800000] ring-2 ring-[#FFDF00] ring-offset-1' : ''
                            }`}
                        >
                          <span className={`truncate font-mono text-xs font-medium uppercase tracking-wide ${style.codeText}`}>
                            {card.service_code}
                          </span>
                          <span className={`shrink-0 font-sans text-xs font-semibold tabular-nums ${style.valueText}`}>
                            {card.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ServiceCellDetail cell={selectedCell} cellData={cellData} onClose={() => setSelectedCell(null)} />

        <div className="mt-5 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]" data-testid="no-services-period">
          <button
            type="button"
            onClick={() => setInactiveOpen((prev) => !prev)}
            aria-expanded={inactiveOpen}
            data-testid="no-services-toggle"
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F1F5F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                data-testid="no-services-count"
                className="inline-flex items-center justify-center rounded-md bg-[#E2E8F0]/80 px-2 py-0.5 font-sans text-xs font-bold tabular-nums text-[#202938]"
              >
                {model.noActivityServices.length}
              </span>
              <span className="font-sans text-xs font-bold text-[#202938]">
                Services with no transactions this period
              </span>
              {inactiveOfficeSummary ? (
                <span className="truncate font-sans text-xs text-[#64748B]">
                  &mdash; {inactiveOfficeSummary}
                </span>
              ) : null}
            </div>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 shrink-0 text-[#64748B] transition-transform ${inactiveOpen ? 'rotate-180' : ''}`}
            >
              <path d="m5 8 5 5 5-5" />
            </svg>
          </button>

          {inactiveOpen ? (
            <div className="border-t border-[#E2E8F0] px-4 py-3.5">
              {!servicesLoaded ? (
                <p className="font-sans text-xs text-[#64748B]">Loading service catalogue…</p>
              ) : model.noActivityServices.length === 0 ? (
                <p className="font-sans text-xs text-[#64748B]" data-testid="no-activity-empty">
                  All active services had completed transactions in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="w-full sm:w-80">
                    <SearchInput
                      value={inactiveQuery}
                      onChange={(e) => setInactiveQuery(e.target.value)}
                      customPlaceholder={`Filter ${model.noActivityServices.length} inactive Citizen's Charter services...`}
                      aria-label="Filter inactive Citizen's Charter services"
                      data-testid="no-activity-search"
                    />
                  </div>
                  {filteredNoActivity.length === 0 ? (
                    <p className="font-sans text-xs text-[#64748B]" data-testid="no-activity-filter-empty">
                      No inactive services match &ldquo;{inactiveQuery}&rdquo;.
                    </p>
                  ) : (
                    <ul className="grid max-h-60 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {filteredNoActivity.map((s) => (
                        <li
                          key={`${s.office_id}-${s.service_id}`}
                          data-testid="no-activity-chip"
                          title={s.office_name ? `${s.service_name} (${s.service_code}) — ${s.office_name}` : s.service_name}
                          className="flex items-center justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-sans text-xs text-[#202938]"
                        >
                          <span className="truncate font-medium">{s.service_name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-[#64748B]">0 transactions</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
