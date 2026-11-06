'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/layout/AppShell.js';
import LandingHero from '../components/public/LandingHero.js';
import ErrorBanner from '../components/feedback/ErrorBanner.js';
import Pager from '../components/navigation/Pager.js';
import StatusBadge from '../components/ui/StatusBadge.js';
import { mightBeSignedIn, refreshSession } from '../lib/auth/session.js';
import { useCatalogue } from '../lib/ui/use-catalogue.js';
import { classificationLabel } from '../lib/api/catalogue.js';
import { CLASSIFICATION_FILTERS, PUBLIC_PAGE_SIZES, hasNarrowing } from '../lib/ui/public-catalogue.js';


function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="ml-4 h-5 w-5 shrink-0 self-center text-slate-500" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l4 4" strokeLinecap="round" />
    </svg>
  );
}

function OfficeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M3 17h14M5 17V7l5-3 5 3v10M8 17v-4h4v4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4 shrink-0 self-center" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M4 5h12M4 10h12M4 15h12" />
    </svg>
  );
}

// Grid / List switch. Only the view changes: the search, filters and page stay as they are.
function ViewToggle({ view, onView }) {
  const button = (value, label, Icon) => {
    const selected = view === value;
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${label} view`}
        onClick={() => onView(value)}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${selected ? 'bg-maroon-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
      >
        <Icon />
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Services view" className="inline-flex gap-1 rounded-xl border border-[#EAE3D9] bg-white p-1 shadow-sm">
      {button('grid', 'Grid', GridIcon)}
      {button('list', 'List', ListIcon)}
    </div>
  );
}

function OfficeSelect({ offices, value, onChange, className = '' }) {
  if (offices.length === 0) return null;
  return (
    <div className={className}>
      <label className="label" htmlFor="office-filter">
        Office
      </label>
      <select id="office-filter" className="input rounded-lg" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All offices</option>
        {offices.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ClassificationPills({ value, onChange }) {
  return (
    <div role="group" aria-label="Classification">
      <p className="label" id="classification-label">
        Classification
      </p>
      <div className="flex flex-wrap gap-2">
        {CLASSIFICATION_FILTERS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value || 'all'}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${selected ? 'border-maroon-900 bg-maroon-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const detailHref = (item) => `/public/${encodeURIComponent(item.service_id)}`;

function rememberServicePosition(item) {
  const target = `${window.location.pathname}${window.location.search}#service-${encodeURIComponent(item.service_id)}`;
  window.history.replaceState(window.history.state, '', target);
  window.sessionStorage.setItem('ccms:catalogue-return', '1');
}

function ServiceCard({ item }) {
  return (
    <li id={`service-${item.service_id}`} className="scroll-mt-6 flex min-w-0 flex-col rounded-2xl border border-[#EAE3D9] bg-white p-5 shadow-sm">
      <div>
        <StatusBadge variant={item.classification}>{classificationLabel(item.classification)}</StatusBadge>
      </div>
      <h3 className="mt-3 break-words font-sans text-lg font-bold leading-snug text-maroon-950">{item.service_name}</h3>
      <p className="mt-2 flex items-start gap-2 text-sm text-slate-500">
        <OfficeIcon />
        <span className="min-w-0 break-words">{item.office_name}</span>
      </p>
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[#EAE3D9] pt-3 text-sm text-slate-800">
          <ClockIcon />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Standard</span>
          <span className="min-w-0 break-words font-semibold">{item.standard_text}</span>
        </div>
        <Link href={detailHref(item)} onClick={() => rememberServicePosition(item)} className="mt-3 inline-block text-sm font-semibold text-maroon-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
          View requirements &rarr;
        </Link>
      </div>
    </li>
  );
}

function ServiceRow({ item }) {
  return (
    <li id={`service-${item.service_id}`} className="scroll-mt-6 min-w-0 rounded-xl border border-l-4 border-[#EAE3D9] border-l-maroon-900 bg-white shadow-sm">
      <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,13rem)_auto] md:items-center md:gap-5">
        <div className="min-w-0">
          <h3 className="break-words font-sans text-base font-bold leading-snug text-maroon-950">{item.service_name}</h3>
          <p className="mt-1 flex items-start gap-2 text-sm text-slate-500">
            <OfficeIcon />
            <span className="min-w-0 break-words">{item.office_name}</span>
          </p>
        </div>
        <div>
          <StatusBadge variant={item.classification}>{classificationLabel(item.classification)}</StatusBadge>
        </div>
        <div className="flex min-w-0 items-start gap-2 text-sm text-slate-800">
          <ClockIcon />
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Standard</span>
            <span className="block break-words font-semibold">{item.standard_text}</span>
          </span>
        </div>
        <Link href={detailHref(item)} onClick={() => rememberServicePosition(item)} className="btn w-full border border-maroon-900 bg-white text-maroon-900 hover:bg-maroon-50 md:w-auto">
          View requirements &rarr;
        </Link>
      </div>
    </li>
  );
}

function ServiceResults({ catalogue }) {
  const { search, classification, office, view, setView, page, setPage, pageSize, changePageSize, state, offices, items, total, onClear, retry, chooseClassification, chooseOffice } = catalogue;
  const list = view === 'list';
  const narrowed = hasNarrowing({ classification, office });
  const noMatch = !state.loading && !state.error && total === 0 && state.all.length >= 0;
  const noServicesAtAll = noMatch && !search && !narrowed && state.all.length === 0;
  const clearLabel = narrowed && !search ? 'Clear filters' : 'Show all services';
  return (
    <section id="services" className="scroll-mt-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-serif text-3xl text-maroon-950">{search ? `Results for "${search}"` : 'All services'}</h2>
          {!state.loading && !state.error ? (
            <p className="mt-1 text-sm text-slate-500" data-testid="service-count">
              Showing {total} {total === 1 ? 'service' : 'services'}
              {state.truncated ? ' (the list is incomplete: too many services to load at once)' : ''}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-end justify-between gap-3 sm:w-auto sm:justify-end">
          <ViewToggle view={view} onView={setView} />
        </div>
      </div>

      <div className="card mb-4 flex flex-wrap items-end justify-between gap-4 p-4">
        <ClassificationPills value={classification} onChange={chooseClassification} />
        <OfficeSelect offices={offices} value={office} onChange={chooseOffice} className="w-full sm:w-72" />
      </div>

      <ErrorBanner message={state.error} />
      {state.error ? (
        <button type="button" className="btn-secondary mb-4" onClick={retry}>
          Try again
        </button>
      ) : null}
      {state.loading && !state.error ? <p className="text-sm text-slate-500" role="status">Loading services…</p> : null}
      {noMatch ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-maroon-50 text-maroon-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
              <path d={search || narrowed ? 'M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4-4' : 'M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z'} />
            </svg>
          </span>
          {noServicesAtAll ? (
            <>
              <p className="mt-4 font-semibold text-slate-900">No services are published yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-600">The list of services will appear here once the offices publish them. Please check back soon.</p>
            </>
          ) : (
            <>
              <p className="mt-4 font-semibold text-slate-900">{search ? `No services match "${search}"` : 'No services match these filters'}</p>
              <p className="mt-1 max-w-sm text-sm text-slate-600">{search ? 'Check the spelling, or try a shorter service or office name.' : 'Try a different classification or office.'}</p>
              <button type="button" className="btn-primary mt-5" onClick={onClear}>
                {clearLabel}
              </button>
            </>
          )}
        </div>
      ) : null}
      {items.length > 0 ? (
        <>
          {list ? (
            <ul className="space-y-3" data-testid="service-list">
              {items.map((item) => (
                <ServiceRow key={item.service_id} item={item} />
              ))}
            </ul>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="service-grid">
              {items.map((item) => (
                <ServiceCard key={item.service_id} item={item} />
              ))}
            </ul>
          )}
          <div className="card mt-4">
            <Pager page={page} pageSize={pageSize} pageSizeOptions={PUBLIC_PAGE_SIZES} total={total} onPage={setPage} onPageSizeChange={changePageSize} loading={state.loading} className="border-t-0!" />
          </div>
        </>
      ) : null}
    </section>
  );
}

// Signed in: the same page, shown as the Dashboard inside the app shell (sidebar and top bar), without the hero.
function SignedInHome() {
  const catalogue = useCatalogue();
  const { input, setInput, onSubmit } = catalogue;
  return (
    <AppShell title="Dashboard" subtitle="Find a service, see what to bring and how long it takes.">
      {/* No Search button: pressing Enter in the box searches. */}
      <form onSubmit={onSubmit} className="card mb-6 flex overflow-hidden" role="search">
        <label className="sr-only" htmlFor="home-search">
          Search services or offices
        </label>
        <SearchIcon />
        <input
          id="home-search"
          type="search"
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
          placeholder="Search by service or office name, then press Enter"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
      <ServiceResults catalogue={catalogue} />
    </AppShell>
  );
}

export default function Landing() {
  // Keep the server render and the first browser render identical. Session state is browser-only,
  // so choose the public or signed-in page after hydration in the effect below.
  const [mode, setMode] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    if (!mightBeSignedIn()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only session check after hydration (see the comment above)
      setMode('public');
      return () => { cancelled = true; };
    }
    const check = refreshSession();
    check
      .then((user) => {
        if (!cancelled) setMode(user ? 'signed-in' : 'public');
      })
      .catch(() => {
        if (!cancelled) setMode('public');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'signed-in') return <SignedInHome />;
  if (mode === 'public') return <LandingHero />;
  return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">Checking your session…</div>;
}
