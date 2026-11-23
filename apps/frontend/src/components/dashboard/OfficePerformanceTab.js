'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getInsightsCell } from '../../lib/api/insights.js';
import { MIN_CELL_COMPLETED, minutesText } from '../../lib/ui/insights.js';
import {
  SERVICE_FILTERS,
  SERVICE_SORTS,
  alertMetrics,
  barLabel,
  buildOfficePerformanceModel,
  filterOfficeServices,
} from '../../lib/ui/office-performance.js';
import { notify } from '../../lib/ui/notify.js';
import { plainFailure } from '../../lib/ui/save-feedback.js';
import StatusBanner from '../feedback/StatusBanner.js';
import SearchInput from '../forms/SearchInput.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import EmptyState from '../ui/EmptyState.js';
import StatusBadge from '../ui/StatusBadge.js';
import ServiceCellDetail from './ServiceCellDetail.js';

const ALERTS_SHOWN = 6;
const OFFICES_SHOWN = 5;
const PAGE_SIZES = [5, 10, 20];

// Status colours stay semantic (green on time, amber needs attention, red delayed), never the brand maroon or gold.
const STATUS_ICON_TONE = { delayed: 'text-danger', attention: 'text-warning', on_time: 'text-success', too_few: 'text-ink-muted', no_data: 'text-ink-muted' };
const ALERT_BORDER = { delayed: 'border-red-200 hover:border-danger', attention: 'border-amber-300 hover:border-warning' };

function StatusIcon({ status, className = 'h-4 w-4' }) {
  const tone = STATUS_ICON_TONE[status.key] ?? 'text-ink-muted';
  const common = { 'aria-hidden': true, viewBox: '0 0 20 20', className: `${className} shrink-0 ${tone}`, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (status.key === 'on_time') return <svg {...common}><circle cx="10" cy="10" r="7.5" /><path d="m6.8 10.2 2.2 2.2 4.2-4.6" /></svg>;
  if (status.key === 'delayed') return <svg {...common}><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.5M10 13.6h.01" /></svg>;
  if (status.key === 'attention') return <svg {...common}><path d="M10 3 17.5 16h-15z" /><path d="M10 8v3.5M10 14h.01" /></svg>;
  return <svg {...common}><circle cx="10" cy="10" r="7.5" /><path d="M7 10h6" /></svg>;
}

/** On-time (green) and late (red) shares of the completed transactions, sized from the real counts. */
function PerformanceBar({ completed, late, className = '' }) {
  const label = barLabel({ completed, late });
  const latePct = completed > 0 ? (late / completed) * 100 : 0;
  return (
    <div role="img" aria-label={label} title={label} className={`flex h-2.5 w-full overflow-hidden rounded-full bg-line ${className}`.trim()}>
      {completed > 0 ? (
        <>
          <span className="h-full bg-success" style={{ width: `${100 - latePct}%` }} />
          <span className="h-full bg-danger" style={{ width: `${latePct}%` }} />
        </>
      ) : null}
    </div>
  );
}

function SectionHeader({ id, title, description, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="font-sans text-xl font-semibold leading-snug text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded-card bg-surface-muted motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

function AttentionSection({ attention, onCheck, showAll, setShowAll }) {
  const delayed = attention.filter((s) => s.status.key === 'delayed').length;
  const shown = showAll ? attention : attention.slice(0, ALERTS_SHOWN);
  return (
    <Card as="section" aria-labelledby="op-attention-title" className="border-l-4 border-l-pup-gold" data-testid="op-attention">
      <SectionHeader
        id="op-attention-title"
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 text-danger" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 17.5 16h-15z" /><path d="M10 8v3.5M10 14h.01" /></svg>
            Needs Immediate Attention
            <StatusBadge variant={delayed ? 'danger' : attention.length ? 'warning' : 'success'} data-testid="op-attention-count">
              {delayed} Delayed {delayed === 1 ? 'Service' : 'Services'}
            </StatusBadge>
          </span>
        )}
        description="These services have exceeded or are at risk of exceeding their Citizen's Charter time limits. Review them and take appropriate action."
        actions={<Button href="/late-risk" variant="secondary" size="sm">Priority Follow-up</Button>}
      />
      {attention.length === 0 ? (
        <EmptyState title="No services need attention" role="status">Every judged service is within its Charter time limit for this period.</EmptyState>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="op-alert-list">
            {shown.map((row) => {
              const m = alertMetrics(row);
              return (
                <li key={row.id} className={`flex flex-col gap-3 rounded-card border bg-surface p-4 shadow-card transition-colors ${ALERT_BORDER[row.status.key]}`} data-testid="op-alert-card">
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge variant={row.status.badge}>{row.status.label}</StatusBadge>
                    {row.service_code ? <span className="font-mono text-xs uppercase text-ink-muted">{row.service_code}</span> : null}
                  </div>
                  <div className="min-w-0">
                    <h3 className="title-card break-words">{row.service_name}</h3>
                    <p className="mt-0.5 text-sm text-ink-muted">{row.office_name}</p>
                  </div>
                  <dl className="space-y-1.5 rounded-control bg-surface-muted px-3 py-2 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-ink-muted">Late rate</dt><dd className="font-semibold tabular-nums text-ink">{m.lateLine}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-ink-muted">Charter limit</dt><dd className="font-semibold tabular-nums text-ink">{m.limitLine}</dd></div>
                    <p className="pt-0.5 text-xs text-ink-muted">{m.overLine}</p>
                  </dl>
                  <Button size="sm" className="mt-auto w-full" onClick={() => onCheck(row)} aria-label={`Check details for ${row.service_name}, ${row.office_name}`}>
                    Check Details
                  </Button>
                </li>
              );
            })}
          </ul>
          {attention.length > ALERTS_SHOWN ? (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? 'Show fewer' : `Show all ${attention.length} services`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function OfficePerformanceSection({ officeRows, selectedId, onSelect, showAll, setShowAll, scopeIsOffice }) {
  const shown = showAll || scopeIsOffice ? officeRows : officeRows.slice(0, OFFICES_SHOWN);
  return (
    <Card as="section" aria-labelledby="op-offices-title" data-testid="op-offices">
      <SectionHeader
        id="op-offices-title"
        title={`Office Performance (${scopeIsOffice ? 'Your Office' : `All ${officeRows.length} ${officeRows.length === 1 ? 'Office' : 'Offices'}`})`}
        description="Compare service performance across offices and identify which offices need attention. Select an office to see its services below."
        actions={(
          <>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted"><span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden="true" />On Time</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted"><span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden="true" />Late / Delayed</span>
            {!scopeIsOffice && officeRows.length > OFFICES_SHOWN ? (
              <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? 'Show Fewer Offices' : 'Show All Offices'}
              </Button>
            ) : null}
          </>
        )}
      />
      {officeRows.length === 0 ? (
        <EmptyState title="No offices to show" role="status">No office has recorded activity in this period.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line" data-testid="op-office-list">
          {shown.map((o) => {
            const selected = String(o.office_id) === String(selectedId);
            const summary = o.completed === 0 ? 'No completed transactions' : `${o.on_time} on time, ${o.late} late`;
            return (
              <li key={o.office_id}>
                <button
                  type="button"
                  onClick={() => onSelect(o.office_id)}
                  aria-pressed={selected}
                  data-testid="op-office-row"
                  className={`grid w-full min-h-16 cursor-pointer grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-l-4 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pup-maroon md:grid-cols-[auto_minmax(0,1.3fr)_auto_minmax(8rem,1fr)_minmax(8rem,auto)] ${selected ? 'border-l-pup-gold bg-maroon-50' : 'border-l-transparent hover:bg-surface-muted'}`}
                >
                  <StatusIcon status={o.status} className="h-5 w-5" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{o.office_name}</span>
                    {o.office_code ? <span className="block truncate font-mono text-xs uppercase text-ink-muted">{o.office_code}</span> : null}
                  </span>
                  <span className="col-start-2 md:col-start-auto"><StatusBadge variant={o.status.badge}>{o.delayed_services > 0 ? 'Has Delays' : o.status.label}</StatusBadge></span>
                  <PerformanceBar completed={o.completed} late={o.late} className="col-span-2 md:col-span-1" />
                  <span className="col-span-2 text-sm tabular-nums text-ink-muted md:col-span-1 md:text-right">{summary}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Active catalogue services of the selected office with no completed transactions this period (collapsed by default). */
function NoActivityServices({ rows }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-card border border-line bg-surface-muted">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="op-no-activity-toggle"
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-card px-4 text-left text-sm font-medium text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon"
      >
        <span>{open ? 'Hide' : 'Show'} {rows.length} {rows.length === 1 ? 'service' : 'services'} with 0 requests this period</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <ul className="grid gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm text-ink sm:grid-cols-2" data-testid="op-no-activity-list">
          {rows.map((s) => (
            <li key={s.service_id} className="min-w-0 break-words">
              {s.service_name}{s.service_code ? <span className="ml-1.5 font-mono text-xs uppercase text-ink-muted">{s.service_code}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ServicesSection({ office, onCheck, minReliable, noActivity = [] }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'performance', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1]);

  const rows = useMemo(() => {
    const filtered = filterOfficeServices(office?.services ?? [], filter, query);
    const cmp = SERVICE_SORTS[sort.key] ?? SERVICE_SORTS.performance;
    // Each comparator is the column's natural order (service A to Z, requests and performance highest or worst first).
    const natural = sort.key === 'service' ? 'asc' : 'desc';
    return [...filtered].sort((a, b) => (sort.direction === natural ? cmp(a, b) : cmp(b, a)));
  }, [office, filter, query, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const columns = [
    {
      key: 'service',
      header: 'Service Name',
      sortable: true,
      width: '34%',
      render: (r) => (
        <div className="min-w-0 whitespace-normal break-words">
          <button type="button" onClick={() => onCheck(r)} className="cursor-pointer rounded text-left text-sm font-semibold leading-snug text-ink hover:text-pup-maroon hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon">
            {r.service_name}
          </button>
          <p className="mt-0.5 text-xs text-ink-muted">{[r.service_code, r.office_name].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'requests', header: 'Requests', sortable: true, width: '12%', align: 'center', render: (r) => <span className="text-sm font-semibold tabular-nums text-ink">{r.completed}</span> },
    {
      key: 'performance',
      header: 'Performance',
      sortable: true,
      width: '20%',
      render: (r) => {
        const tip = r.status.key === 'too_few' ? `Fewer than ${minReliable} completed transactions, so no judgement is made.` : `${r.late} late of ${r.completed} completed (${r.late_rate}% late).`;
        const text = r.status.key === 'delayed' || r.status.key === 'attention' ? `${r.status.label} · ${r.late_rate}%` : r.status.label;
        return <StatusBadge variant={r.status.badge} title={tip}>{text}</StatusBadge>;
      },
    },
    {
      key: 'limit',
      header: 'Charter Time Limit',
      width: '18%',
      render: (r) => (
        <div className="whitespace-normal">
          <span className="text-sm tabular-nums text-ink">{r.limit_text}</span>
          {r.p90_minutes != null ? <p className="mt-0.5 text-xs text-ink-muted" title="90% of completed transactions finished within this time">9 in 10 done within {minutesText(r.p90_minutes)}</p> : null}
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '16%',
      align: 'right',
      render: (r) => <Button variant="outline" size="sm" onClick={() => onCheck(r)} aria-label={`View details for ${r.service_name}`}>View Details</Button>,
    },
  ];

  return (
    <Card as="section" aria-labelledby="op-services-title" data-testid="op-services">
      <SectionHeader
        id="op-services-title"
        title={office ? `Services by ${office.office_name}` : 'Services by Office'}
        description="Review individual service performance against the Citizen's Charter. Select another office above to compare."
        actions={office ? <StatusBadge variant="brand">{office.office_code || office.office_name}</StatusBadge> : null}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Filter services by performance" className="inline-flex rounded-control border border-line bg-surface-muted p-0.5">
          {SERVICE_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => { setFilter(value); setPage(1); }}
              data-testid={`op-filter-${value}`}
              className={`min-h-9 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon ${filter === value ? 'bg-pup-maroon text-white shadow-sm' : 'text-ink-muted hover:bg-surface hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-full min-w-0 sm:w-72 sm:flex-1 sm:max-w-sm">
          <label htmlFor="op-service-search" className="sr-only">Search by service name or code</label>
          <SearchInput
            id="op-service-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            customPlaceholder="Search service name or code…"
            data-testid="op-service-search"
          />
        </div>
      </div>
      <DataTable
        label={`Services of ${office?.office_name ?? 'the selected office'}`}
        columns={columns}
        data={pageRows}
        keyExtractor={(r) => r.id}
        emptyMessage={office ? (query || filter !== 'all' ? 'No services match these filters.' : 'No completed transactions for this office in this period.') : 'Select an office to see its services.'}
        sort={sort}
        onSortChange={(key) => { setSort((s) => (s.key === key ? { key, direction: s.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'service' ? 'asc' : 'desc' })); setPage(1); }}
        summaryText={`Showing ${pageRows.length} of ${rows.length} active ${rows.length === 1 ? 'service' : 'services'}`}
        pagination={{ page: safePage, pageSize, total: rows.length, onPage: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); }, pageSizeOptions: PAGE_SIZES }}
        minWidth="44rem"
      />
      <NoActivityServices rows={noActivity} />
    </Card>
  );
}

/**
 * The Office Performance Overview tab: Needs Immediate Attention, Office Performance and Services by Office.
 * Everything is derived from the Dashboard's own overview (heatmap and Charter check), so the figures, the 10% / 20% late-rate
 * thresholds and each office's access scope are the existing ones. "Check Details" opens the existing weekly breakdown and
 * late-transaction panel (ServiceCellDetail, fed by the insights cell endpoint).
 */
export default function OfficePerformanceTab({ overview, period, offices = [], services = [], names = {}, scope, loading = false, error = null, children }) {
  const model = useMemo(() => buildOfficePerformanceModel({ overview, offices, services, names, scope }), [overview, offices, services, names, scope]);
  const minReliable = Number(overview?.min_cell_completed) || MIN_CELL_COMPLETED;
  const scopeIsOffice = scope?.kind === 'office';

  const [pickedOffice, setPickedOffice] = useState('');
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllOffices, setShowAllOffices] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const seqRef = useRef(0);

  // The chosen office, or (until one is chosen, or when it leaves the list) the one that most needs attention.
  const selected = model.offices.find((o) => String(o.office_id) === String(pickedOffice)) ?? model.offices[0] ?? null;
  useEffect(() => { seqRef.current += 1; }, [period]);

  async function openDetail(row) {
    const seq = ++seqRef.current;
    setDetail({ ...row.cell, service_name: row.service_name, office_name: row.office_name, too_few: row.status.key === 'too_few' });
    setDetailData(null);
    try {
      const data = await getInsightsCell({ officeId: row.office_id, serviceId: row.service_id, period });
      if (seq === seqRef.current) setDetailData(data);
    } catch (failure) {
      if (seq === seqRef.current) {
        setDetail(null);
        notify.error(plainFailure(failure, { fallback: 'The service details could not be loaded. Please try again.' }));
      }
    }
  }

  if (error) return <StatusBanner variant="error" message={error} />;
  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading office performance">
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-80" />
      </div>
    );
  }
  if (!overview) return null;

  return (
    <div className="space-y-4" data-testid="office-performance-tab">
      <AttentionSection attention={model.attention} onCheck={openDetail} showAll={showAllAlerts} setShowAll={setShowAllAlerts} />
      <OfficePerformanceSection
        officeRows={model.offices}
        selectedId={selected?.office_id}
        onSelect={setPickedOffice}
        showAll={showAllOffices}
        setShowAll={setShowAllOffices}
        scopeIsOffice={scopeIsOffice}
      />
      <ServicesSection key={`${period}:${selected?.office_id ?? ''}`} office={selected} onCheck={openDetail} minReliable={minReliable} noActivity={selected?.no_activity ?? []} />
      {children}
      <Modal open={Boolean(detail)} title="Service details" onClose={() => setDetail(null)} widthClass="max-w-3xl">
        <ServiceCellDetail cell={detail} cellData={detailData} onClose={() => setDetail(null)} testId="op-cell-detail" summaryTestId="op-cell-summary" />
      </Modal>
    </div>
  );
}
