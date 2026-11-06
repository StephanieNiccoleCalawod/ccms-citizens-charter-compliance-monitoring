'use client';

import { recordOption } from '../../lib/ui/record-status.js';
import RecordOption from '../../components/forms/RecordOption.js';
import SearchInput from '../../components/forms/SearchInput.js';
import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import Modal from '../../components/modals/Modal.js';
import TransactionDetail from '../../components/transactions/TransactionDetail.js';
import StartTransactionForm from '../../components/transactions/StartTransactionForm.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import Pager from '../../components/navigation/Pager.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { listCounters } from '../../lib/api/operations.js';
import { listSelectableServices, listTransactionPage } from '../../lib/api/transactions.js';
import { apiFetch } from '../../lib/auth/session.js';
import { COMPLIANCE_LABELS, complianceState } from '../../lib/ui/complete-transaction.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { splitDateTime } from '../../lib/ui/audit-log.js';
import { EMPTY_TX_FILTERS, STATUS_OPTIONS, TRACKING_MAX, emptyMessage, filterErrors, filtersToSearch, hasFilters, listErrorResult, searchToFilters } from '../../lib/ui/transaction-list.js';
import { statusLabel } from '../../lib/ui/start-transaction.js';
import SearchableSelect from '../../components/forms/SearchableSelect.js';
import { officeName } from '../../lib/ui/names.js';

const COLUMNS = 9;
const EMPTY_PAGE = { items: [], total: 0, page: 1 };

/** A date and time from the API as two lines (MM/DD/YYYY over the 12-hour time), like the Audit Logs table; "-" when there is none. */
function DateTimeCell({ value }) {
  const { date, time } = splitDateTime(formatDateTime(value) || '-');
  return (
    <>
      <span className="block font-semibold text-slate-900">{date}</span>
      {time ? <span className="block text-slate-500">{time}</span> : null}
    </>
  );
}

/** Role-scoped list: the service decides which rows this person may see; filters, order and paging are all the service's. */
function TransactionList({ user }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  // Where the list starts: the filters and page in the address (so Back from a transaction returns to the same view).
  const address = useSearchParams().toString();
  const [start] = useState(() => searchToFilters(address));
  const [draft, setDraft] = useState(start.filters);
  const [applied, setApplied] = useState(start.filters);
  const [pageSize, setPageSize] = useState(start.pageSize);
  const [fieldErrors, setFieldErrors] = useState({});
  const [state, setState] = useState({ loading: true, ...EMPTY_PAGE, error: null });
  const [options, setOptions] = useState({ services: [], counters: [], offices: [] });
  const [selectedId, setSelectedId] = useState(null); // the transaction open in the details modal (the list, filters and page stay as they are)
  const [detailBusy, setDetailBusy] = useState(false); // an action inside the modal is running: do not let it be closed under it
  const [addOpen, setAddOpen] = useState(false); // the Add Transaction modal
  const [addDirty, setAddDirty] = useState(false); // something typed or chosen in it
  const [addBusy, setAddBusy] = useState(false); // the new transaction is being sent
  const [discardAsk, setDiscardAsk] = useState(false); // "discard what you entered?"
  const latest = useRef(0); // the newest request; an older answer that arrives late is thrown away

  async function run(filters, page, size) {
    const id = ++latest.current;
    setApplied(filters);
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listTransactionPage(filters, page, size);
      if (id !== latest.current) return;
      setState({ loading: false, items: data.items ?? [], total: data.total ?? 0, page: data.page ?? page, error: null });
      window.history.replaceState(null, '', `${window.location.pathname}${filtersToSearch(filters, page, size)}`);
    } catch (err) {
      if (id !== latest.current) return;
      const { message, fieldErrors: fields } = listErrorResult(err);
      setFieldErrors(fields);
      setState({ loading: false, ...EMPTY_PAGE, error: message ?? 'Please correct the highlighted filters.' });
    }
  }

  // After something changed inside the modal: read the same page again with the same filters (the table keeps its view).
  const refreshList = useCallback(() => run(applied, state.page, pageSize), [applied, state.page, pageSize]);

  function closeAdd() {
    if (addDirty) setDiscardAsk(true);
    else setAddOpen(false);
  }

  // A transaction was started in the modal: close it, say so, and read the list again from page 1 (newest first) with the same filters.
  function handleCreated() {
    setAddOpen(false);
    setAddDirty(false);
    run(applied, 1, pageSize);
  }

  // First load, plus the choices for the Service, Counter and (Super Admin) Office filters. The choices are a convenience:
  // if one list cannot be loaded the filter just has fewer options and the table still works.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the list the address bar describes
    run(start.filters, start.page, start.pageSize);
    Promise.allSettled([listSelectableServices(), listCounters(undefined), isSuperAdmin ? apiFetch(OFFICES_API) : Promise.resolve(null)]).then(([services, counters, offices]) => {
      if (cancelled) return;
      setOptions({
        services: services.status === 'fulfilled' ? services.value : [],
        counters: counters.status === 'fulfilled' ? counters.value?.items ?? [] : [],
        offices: offices.status === 'fulfilled' ? offices.value?.items ?? [] : [],
      });
    });
    return () => {
      cancelled = true;
      latest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: the starting view never changes
  }, [isSuperAdmin]);

  // Applies these filters now: a dropdown as soon as it changes, the tracking number on Enter or when the field is left.
  function applyNow(next) {
    setDraft(next);
    const errors = filterErrors(next);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    run(next, 1, pageSize); // any change of filters starts again at page 1
  }

  function apply(event) {
    event.preventDefault();
    applyNow(draft);
  }

  // The tracking number applies after a short pause in typing (Enter, or leaving the field, applies at once).
  useEffect(() => {
    if (draft.q.trim() === (applied.q ?? '')) return undefined;
    const timer = setTimeout(() => applyNow(draft), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyNow reads the values it is given
  }, [draft, applied]);

  function clear() {
    setDraft({ ...EMPTY_TX_FILTERS });
    setFieldErrors({});
    run({ ...EMPTY_TX_FILTERS }, 1, pageSize);
  }

  function changePageSize(value) {
    const size = Number(value);
    setPageSize(size);
    run(applied, 1, size);
  }

  const set = (name) => (e) => {
    setDraft({ ...draft, [name]: e.target.value });
    setFieldErrors((errors) => ({ ...errors, [name]: undefined }));
  };
  const choose = (name) => (e) => applyNow({ ...draft, [name]: e.target.value });
  const fieldError = (name) => (fieldErrors[name] ? <p id={`tx-${name}-error`} className="mt-1 text-xs text-red-700">{fieldErrors[name]}</p> : null);
  const describedBy = (name, extra) => [fieldErrors[name] ? `tx-${name}-error` : null, extra].filter(Boolean).join(' ') || undefined;
  // The Service filter: "All services" first, then each service by name with its office underneath (typing matches name, code or office).
  const serviceFilterOptions = [
    { value: '', label: 'All services', search: 'all services' },
    ...options.services.map((s) => recordOption(s, s.service_id, s.service_name, {
      secondary: officeName(s),
      search: `${s.service_name} ${s.service_code ?? ''} ${s.office_name ?? ''} ${s.office_code ?? ''}`,
    })),
  ];
  const filtered = hasFilters(applied);
  const showCounter = options.counters.length > 0;

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((current) => ({ ...current, error: null }))} />

      <form className="card p-5 sm:p-6" onSubmit={apply} noValidate aria-label="Filter the transactions">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="tx-q">Tracking number</label>
            <SearchInput id="tx-q" value={draft.q} onChange={set('q')} onBlur={() => draft.q.trim() !== (applied.q ?? '') && applyNow(draft)} maxLength={TRACKING_MAX} autoComplete="off" spellCheck={false} aria-invalid={fieldErrors.q ? true : undefined} aria-describedby={describedBy('q')} />
            {fieldError('q')}
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="tx-status">Status</label>
            <select id="tx-status" className="input select-chevron" value={draft.status} onChange={choose('status')} aria-invalid={fieldErrors.status ? true : undefined} aria-describedby={describedBy('status')}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {fieldError('status')}
          </div>
          <div className="w-full sm:w-52">
            <label className="label" htmlFor="tx-service">Service</label>
            <SearchableSelect
              id="tx-service"
              options={serviceFilterOptions}
              value={draft.service_id}
              onChange={(value) => applyNow({ ...draft, service_id: value })}
              placeholder="All services"
              noMatchText="No service matches what you typed."
              clearable={false}
              listMinWidth={420}
              invalid={Boolean(fieldErrors.service_id)}
              describedBy={describedBy('service_id')}
            />
            {fieldError('service_id')}
          </div>
          {isSuperAdmin ? (
            <div className="w-full sm:w-48">
              <label className="label" htmlFor="tx-office">Office</label>
              <select id="tx-office" className="input select-chevron" value={draft.office_id} onChange={choose('office_id')} aria-invalid={fieldErrors.office_id ? true : undefined} aria-describedby={describedBy('office_id')}>
                <option value="">All offices</option>
                {options.offices.map((o) => <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>)}
              </select>
              {fieldError('office_id')}
            </div>
          ) : null}
          {showCounter ? (
            <div className="w-full sm:w-40">
              <label className="label" htmlFor="tx-counter">Counter</label>
              <select id="tx-counter" className="input select-chevron" value={draft.counter_id} onChange={choose('counter_id')} aria-invalid={fieldErrors.counter_id ? true : undefined} aria-describedby={describedBy('counter_id')}>
                <option value="">All counters</option>
                {options.counters.map((c) => <RecordOption key={c.counter_id} record={c} value={c.counter_id}>{c.label}</RecordOption>)}
              </select>
              {fieldError('counter_id')}
            </div>
          ) : null}
          {filtered ? (
            <div className="sm:mt-[21px]">
              <ClearFiltersButton onClick={clear} disabled={state.loading} />
            </div>
          ) : null}
          <AddTransactionButton className="w-full justify-center sm:ml-auto sm:mt-[21px] sm:w-auto" onClick={() => setAddOpen(true)} />
        </div>
      </form>

      <TableShell
        footer={<Pager page={state.page} pageSize={pageSize} total={state.total} onPage={(next) => run(applied, next, pageSize)} onPageSizeChange={changePageSize} loading={state.loading} />}
      >
        <Table
          minWidth="56rem"
          busy={state.loading}
          head={
            <tr>
              <Th className="whitespace-nowrap">Tracking number</Th>
              <Th className="min-w-40">Service</Th>
              <Th className="min-w-36">Office</Th>
              <Th className="whitespace-nowrap">Counter</Th>
              <Th className="whitespace-nowrap">Status</Th>
              <Th className="whitespace-nowrap">Started</Th>
              <Th className="whitespace-nowrap">Ended</Th>
              <Th className="whitespace-nowrap">Result</Th>
              <Th align="right">Action</Th>
            </tr>
          }
        >
          {state.loading && state.items.length === 0 ? (
            <TableState colSpan={COLUMNS} kind="loading">Loading transactions...</TableState>
          ) : state.items.length === 0 ? (
            <TableState colSpan={COLUMNS}>{emptyMessage({ error: state.error, filtered })}</TableState>
          ) : (
            state.items.map((t) => {
              const result = complianceState(t);
              return (
                <tr key={t.transaction_id} className="tr-row" data-testid="tx-row">
                  <td className="td">
                    <span className="whitespace-nowrap font-mono font-semibold text-maroon-800">{t.tracking_no}</span>
                    {t.is_backdated === true ? <span className="block text-xs text-slate-500">Entered after the fact</span> : null}
                  </td>
                  <td className="td">
                    <span className="block font-semibold text-slate-900">{t.service_name}</span>
                  </td>
                  <td className="td"><span className="block font-semibold text-slate-900">{officeName(t)}</span></td>
                  <td className="td">{t.counter_label || '-'}</td>
                  <td className="td whitespace-nowrap"><StatusBadge variant={String(t.status).toLowerCase()}>{statusLabel(t.status)}</StatusBadge></td>
                  <td className="td whitespace-nowrap"><DateTimeCell value={t.started_at} /></td>
                  <td className="td whitespace-nowrap"><DateTimeCell value={t.ended_at} /></td>
                  <td className="td">{result === 'none' ? '-' : <StatusBadge variant={result}>{COMPLIANCE_LABELS[result]}</StatusBadge>}</td>
                  <td className="td whitespace-nowrap text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.transaction_id)}
                      aria-label={`View details of ${t.tracking_no}`}
                      aria-haspopup="dialog"
                      className="rounded text-xs font-semibold text-maroon-800 hover:text-maroon-950 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-1"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </Table>
      </TableShell>

      <Modal
        open={selectedId !== null}
        title="Transaction Details"
        widthClass="max-w-3xl"
        showClose
        fullScreenOnMobile
        onClose={detailBusy ? undefined : () => setSelectedId(null)}
      >
        {selectedId !== null ? (
          <TransactionDetail
            key={selectedId}
            id={selectedId}
            role={user.role}
            embedded
            onChanged={refreshList}
            onBusyChange={setDetailBusy}
          />
        ) : null}
      </Modal>

      <Modal
        open={addOpen}
        title="Add Transaction"
        widthClass="max-w-2xl"
        showClose
        flushBody
        fullScreenOnMobile
        dirty={addDirty}
        onClose={addBusy ? undefined : closeAdd}
      >
        {addOpen ? <StartTransactionForm key="add" user={user} embedded onCreated={handleCreated} onCancel={closeAdd} onDirtyChange={setAddDirty} onBusyChange={setAddBusy} /> : null}
      </Modal>

      <ConfirmDialog
        open={discardAsk}
        title="Discard this transaction?"
        message="What you entered has not been saved. If you close now, it will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setDiscardAsk(false);
          setAddOpen(false);
          setAddDirty(false);
        }}
        onCancel={() => setDiscardAsk(false)}
      />
    </div>
  );
}

/**
 * The way into starting a transaction: a button that opens the Add Transaction modal on this page. The form itself, the page at
 * /transactions/new and the Operations service all enforce who may start one, so showing or hiding this button grants nothing.
 */
/** The way into Transaction Settings (/settings): an icon at the right of the page heading. The page checks the role itself and the service decides what can be changed. */
function SettingsLink() {
  return (
    <Link href="/settings" className="btn-secondary h-10 w-10 px-0" aria-label="Transaction Settings" title="Transaction Settings" data-testid="transaction-settings">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />
      </svg>
    </Link>
  );
}

function AddTransactionButton({ className = '', onClick }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className={`btn-primary ${className}`.trim()} data-testid="add-transaction">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10 4v12M4 10h12" />
      </svg>
      Add Transaction
    </button>
  );
}

export default function TransactionsPage() {
  return (
    <AppShell
      title="Transactions"
      subtitle="Newest first. You only see the transactions your role allows. Dates are Manila calendar days (Asia/Manila)."
      allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}
      headerRight={<SettingsLink />}
    >
      {(user) => (
        <Suspense fallback={null}>
          <TransactionList user={user} />
        </Suspense>
      )}
    </AppShell>
  );
}
