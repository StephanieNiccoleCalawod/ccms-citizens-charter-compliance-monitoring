'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ErrorBanner from '../feedback/ErrorBanner.js';
import Modal from '../modals/Modal.js';
import Pager from '../navigation/Pager.js';
import PublicServiceView from '../service/PublicServiceView.js';
import { PUBLIC_SERVICES_API } from '../../lib/api/catalogue.js';
import { publicFetch } from '../../lib/api/client.js';
import { BRAND } from '../../lib/constants/brand.js';
import { clampPage, pageOf } from '../../lib/ui/public-catalogue.js';
import { DIRECTORY_PAGE_SIZE, TIME_FILTERS, filterByTime, officeCounts, sequenceLabel, showingRange, sortByName } from '../../lib/ui/public-directory.js';

// Palette of the directory (the home page for people who are not signed in).
const CREAM = '#F8F5F0';
const DIVIDER = '#E6DCD0';
const DARK = '#351515';
const MUTED = '#756E68';

function ServiceRow({ number, item, onView }) {
  return (
    <li className="grid gap-x-6 gap-y-3 border-b py-5 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,15rem)_auto] md:items-center" style={{ borderColor: DIVIDER }}>
      <span className="font-serif text-xl" style={{ color: MUTED }} aria-hidden="true">{sequenceLabel(number)}</span>
      <div className="min-w-0">
        <h3 className="break-words font-sans text-base font-bold leading-snug" style={{ color: DARK }}>
          <span className="sr-only">{sequenceLabel(number)}. </span>
          {item.service_name}
        </h3>
        <p className="mt-1 break-words text-sm" style={{ color: MUTED }}>{item.office_name}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>Standard</p>
        <p className="break-words text-sm font-semibold" style={{ color: DARK }}>{item.standard_text}</p>
      </div>
      <div className="md:text-right">
        <button
          type="button"
          onClick={() => onView(item)}
          aria-haspopup="dialog"
          className="rounded text-sm font-semibold text-[#800000] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-2"
        >
          View requirements<span className="sr-only"> for {item.service_name}</span> &rarr;
        </button>
      </div>
    </li>
  );
}

/** The existing public service detail, loaded for one service and shown in a modal. */
function RequirementsBody({ service }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    publicFetch(`${PUBLIC_SERVICES_API}/${encodeURIComponent(service.service_id)}`)
      .then((data) => !cancelled && setState({ loading: false, data: data.service, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, data: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [service.service_id]);
  if (state.loading) return <p className="text-sm text-slate-500" role="status">Loading requirements…</p>;
  if (state.error) return <ErrorBanner message={state.error} />;
  return <PublicServiceView service={state.data} embedded />;
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-2 ${active ? 'border-[#570D12] bg-[#570D12] text-white' : 'bg-transparent hover:bg-white'}`}
      style={active ? undefined : { borderColor: DIVIDER, color: DARK }}
    >
      {children}
    </button>
  );
}

export default function PublicDirectory({ catalogue }) {
  const { input, setInput, search, state, office, chooseOffice, onSubmit, onClear, retry } = catalogue;
  const [time, setTime] = useState('');
  const [direction, setDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DIRECTORY_PAGE_SIZE);
  const [selected, setSelected] = useState(null); // the service whose requirements are open

  const counts = useMemo(() => officeCounts(state.all), [state.all]);
  const sorted = useMemo(() => {
    const byOffice = office ? state.all.filter((s) => s.office_name === office) : state.all;
    return sortByName(filterByTime(byOffice, time), direction);
  }, [state.all, office, time, direction]);
  const total = sorted.length;
  const current = clampPage(page, total, pageSize);
  const items = pageOf(sorted, current, pageSize);
  const range = showingRange(current, pageSize, total);

  const narrowed = Boolean(office || time || search);
  const heading = search ? `Results for "${search}"` : office || 'All services';
  const empty = !state.loading && !state.error && total === 0;

  // A different page size starts again at page 1; the search and filters stay.
  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  function resetFilters() {
    setTime('');
    setDirection('asc');
    setPage(1);
    onClear();
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM, color: DARK }}>
      <main className="mx-auto min-w-0 max-w-6xl px-5 py-8 md:px-8 lg:px-12 lg:py-10">
        <Link href="/" className="inline-flex items-center gap-2 rounded text-sm font-semibold text-[#800000] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-2">
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <form onSubmit={(e) => { setPage(1); onSubmit(e); }} role="search" className="mt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full min-w-0 sm:w-80">
              <label className="label" htmlFor="public-search">Search</label>
              <div className="relative">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input id="public-search" type="search" className="input pl-9" placeholder="Search by service or office name" value={input} onChange={(e) => setInput(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn-secondary w-full sm:w-auto">Search</button>
            <div className="w-full min-w-0 sm:ml-auto sm:w-72">
              <label className="label" htmlFor="public-office">Office</label>
              <select id="public-office" className="input" value={office} onChange={(e) => { chooseOffice(e.target.value); setPage(1); }}>
                <option value="">All offices ({counts.total})</option>
                {counts.offices.map((o) => (
                  <option key={o.name} value={o.name}>{o.name} ({o.count})</option>
                ))}
                {office && !counts.offices.some((o) => o.name === office) ? <option value={office}>{office} (0)</option> : null}
              </select>
            </div>
          </div>
        </form>

        <section className="mt-9" aria-labelledby="directory-heading">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h2 id="directory-heading" className="break-words font-serif text-3xl" style={{ color: DARK }}>{heading}</h2>
              {!state.loading && !state.error ? (
                <p className="mt-1 text-sm" style={{ color: MUTED }} data-testid="service-count">
                  {total} {total === 1 ? 'service' : 'services'}
                  {state.truncated ? ' (the list is incomplete: too many services to load at once)' : ''}
                </p>
              ) : null}
            </div>
            <div role="group" aria-label="Processing time and order" className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
              {TIME_FILTERS.map((f) => (
                <FilterPill key={f.value || 'any'} active={time === f.value} onClick={() => { setTime(f.value); setPage(1); }}>{f.label}</FilterPill>
              ))}
              <FilterPill active onClick={() => { setDirection((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}>
                {direction === 'asc' ? 'A–Z' : 'Z–A'}
              </FilterPill>
            </div>
          </div>

          <ErrorBanner message={state.error} />
          {state.error ? <button type="button" className="btn-secondary mt-3" onClick={retry}>Try again</button> : null}
          {state.loading && !state.error ? <p className="mt-6 text-sm" style={{ color: MUTED }} role="status">Loading services…</p> : null}

          {empty ? (
            <div className="mt-6 rounded-xl border bg-white px-6 py-12 text-center" style={{ borderColor: DIVIDER }}>
              {state.all.length === 0 && !narrowed ? (
                <>
                  <p className="font-semibold">No services are published yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: MUTED }}>The list of services will appear here once the offices publish them. Please check back soon.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">{search ? `No services match "${search}"` : 'No services match these filters'}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: MUTED }}>
                    {search ? 'Check the spelling, or try a shorter service or office name.' : 'Try another office or processing time. Services with working days are not counted as under 10 or 20 minutes.'}
                  </p>
                  <button type="button" className="btn-primary mt-5" onClick={resetFilters}>Show all services</button>
                </>
              )}
            </div>
          ) : null}

          {items.length > 0 ? (
            <>
              <ol className="mt-4 border-t" style={{ borderColor: DIVIDER }} data-testid="service-list" start={range.from}>
                {items.map((item, index) => (
                  <ServiceRow key={item.service_id} number={range.from + index} item={item} onView={setSelected} />
                ))}
              </ol>
              <div className="mt-2">
                <Pager page={current} pageSize={pageSize} total={total} onPage={setPage} onPageSizeChange={changePageSize} className="border-t-0! px-0!" />
              </div>
            </>
          ) : null}
        </section>

        <footer className="mt-12 border-t pt-5 text-center text-sm" style={{ borderColor: DIVIDER, color: MUTED }}>
          {BRAND.campus} &middot; {BRAND.fullName}
        </footer>
      </main>

      <Modal open={selected !== null} title="Service requirements" widthClass="max-w-4xl" showClose fullScreenOnMobile onClose={() => setSelected(null)}>
        {selected ? <RequirementsBody key={selected.service_id} service={selected} /> : null}
      </Modal>
    </div>
  );
}
