'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { getAccountNames, getComplaintSummary, getKpis, getOfficeNames, getOfficePendingTransactions } from '../../lib/api/kpis.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { DEFAULT_PERIOD, HOME_MESSAGES, PERIOD_OPTIONS, failureMessage, groupByFor, officeRows, periodLabel, sortOfficeRows, staffRows, tilesFor } from '../../lib/ui/kpi-home.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import DataTable from '../ui/DataTable.js';
import StatCard from '../ui/StatCard.js';
import StatusBadge from '../ui/StatusBadge.js';
import TermPeriodOptions, { useTerms } from '../forms/TermPeriodOptions.js';
import { TERMS_NOT_AVAILABLE, termPeriodText } from '../../lib/ui/term-period.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import TableState from '../ui/TableState.js';

// The home screen of Office Head / Office Staff (CC036) and of the Executive (CC037): the KPI tiles for a period, a table below,
// pending transactions & complaints for offices, and a link to Dashboard analytics. The Executive never gets per-staff figures (server-enforced).
export default function KpiHome({ user }) {
  const executive = user.role === ROLES.EXECUTIVE;
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const termState = useTerms();
  const [state, setState] = useState({ status: 'loading', answer: null, error: '' });
  const [totals, setTotals] = useState(null);
  const [names, setNames] = useState(new Map());
  const [officeSort, setOfficeSort] = useState({ key: 'rate', direction: 'asc' });
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(20);
  const [pendingState, setPendingState] = useState({ loading: false, items: [], total: 0, error: '' });
  const [complaintsState, setComplaintsState] = useState({ loading: false, data: null, error: '' });

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) setState((s) => ({ ...s, status: 'loading', error: '' }));
    });
    const common = { period, officeId: executive ? undefined : user.officeId };
    Promise.all([getKpis({ ...common, groupBy: groupByFor(user.role) }), getKpis({ ...common, groupBy: 'total' })])
      .then(([grouped, total]) => { if (active) { setState({ status: 'ready', answer: grouped, error: '' }); setTotals(total); } })
      .catch((failure) => { if (active) setState((s) => ({ ...s, status: 'error', error: failureMessage(failure) })); });
    return () => { active = false; };
  }, [period, executive, user.officeId, user.role]);

  useEffect(() => {
    let active = true;
    if (executive) {
      getOfficeNames().then((map) => active && setNames(map)).catch(() => {});
    } else if (user.role === ROLES.OFFICE_HEAD) {
      getAccountNames().then((map) => active && setNames(map)).catch(() => {});
    } else {
      Promise.resolve().then(() => {
        if (active) setNames(new Map([[user.id, user.fullName]]));
      });
    }
    return () => { active = false; };
  }, [executive, user.role, user.id, user.fullName]);

  useEffect(() => {
    if (executive) return undefined;
    let active = true;
    Promise.resolve().then(() => {
      if (active) setPendingState((s) => ({ ...s, loading: true, error: '' }));
    });
    getOfficePendingTransactions({ page: pendingPage, pageSize: pendingPageSize })
      .then((data) => {
        if (!active) return;
        setPendingState({
          loading: false,
          items: Array.isArray(data?.items) ? data.items : [],
          total: Number.isFinite(Number(data?.total)) ? Number(data.total) : 0,
          error: '',
        });
      })
      .catch((failure) => {
        if (active) setPendingState((s) => ({ ...s, loading: false, items: [], error: failure?.message || 'Pending transactions could not be loaded.' }));
      });
    return () => { active = false; };
  }, [executive, user.officeId, pendingPage, pendingPageSize]);

  useEffect(() => {
    if (executive) return undefined;
    let active = true;
    Promise.resolve().then(() => {
      if (active) setComplaintsState((s) => ({ ...s, loading: true, error: '' }));
    });
    getComplaintSummary({ officeId: user.officeId })
      .then((data) => { if (active) setComplaintsState({ loading: false, data, error: '' }); })
      .catch((failure) => { if (active) setComplaintsState({ loading: false, data: null, error: failure?.message || 'Complaints summary could not be loaded.' }); });
    return () => { active = false; };
  }, [executive, user.officeId]);

  const tiles = useMemo(() => tilesFor(totals), [totals]);
  const baseOfficeRows = useMemo(() => (executive && state.answer ? officeRows(state.answer.groups, names) : []), [executive, state.answer, names]);
  const sortedOfficeRows = useMemo(() => sortOfficeRows(baseOfficeRows, officeSort), [baseOfficeRows, officeSort]);
  const rows = useMemo(() => (executive ? [] : staffRows(state.answer?.groups, names)), [executive, state.answer, names]);
  const loading = state.status === 'loading';
  const label = termPeriodText(period, termState.terms) ?? periodLabel(state.answer);

  const toggleOfficeSort = (key) => setOfficeSort((current) => (
    current?.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'name' || key === 'rate' ? 'asc' : 'desc' }
  ));

  const officeColumns = [
    { key: 'name', header: 'Office', sortable: true, render: (row) => <span className="td-primary">{row.name}</span> },
    { key: 'received', header: 'Received', align: 'right', sortable: true, className: 'tabular-nums', render: (row) => row.received },
    { key: 'onTime', header: 'On time', align: 'right', sortable: true, className: 'tabular-nums', render: (row) => row.onTime },
    { key: 'late', header: 'Late', align: 'right', sortable: true, className: 'tabular-nums', render: (row) => row.late },
    { key: 'rate', header: 'On-time rate', align: 'right', sortable: true, className: 'tabular-nums', render: (row) => (row.rate === null ? <span className="td-muted">{HOME_MESSAGES.noRate}</span> : <span className="font-semibold">{row.rate}%</span>) },
    { key: 'pending', header: 'Pending', align: 'right', sortable: true, className: 'tabular-nums', render: (row) => row.pending },
  ];

  const pendingColumns = [
    {
      key: 'tracking_no',
      header: 'Tracking number',
      render: (row) => (
        <Link href={`/transactions/${encodeURIComponent(row.transaction_id)}`} className="row-action px-0 tabular-nums">
          {row.tracking_no}
        </Link>
      ),
    },
    { key: 'service', header: 'Service', render: (row) => <span className="td-medium">{row.service_name || row.service_code || HOME_MESSAGES.notAvailable}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge variant={row.status === 'ON_HOLD' ? 'warning' : 'neutral'}>
          {row.status === 'ON_HOLD' ? 'Paused (waiting for the client)' : 'In progress'}
        </StatusBadge>
      ),
    },
    { key: 'started_at', header: 'Started', className: 'tabular-nums', render: (row) => formatDateTime(row.started_at) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="kpi-period" className="label">Period</label>
          <select id="kpi-period" className="input select-chevron" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <TermPeriodOptions terms={termState.terms} />
          </select>
          {termState.loaded && termState.terms.length === 0 ? <p className="mt-1 text-xs text-slate-500" data-testid="terms-unavailable">{TERMS_NOT_AVAILABLE}</p> : null}
        </div>
        <div className="flex items-center gap-4">
          {label ? <p className="text-xs text-slate-500" data-testid="kpi-period-range">{label}</p> : null}
          <Link href="/" className="btn-secondary" data-testid="kpi-dashboard-link">Open Dashboard</Link>
        </div>
      </div>
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: '' }))} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-tiles" aria-busy={loading}>
        {tiles.map((tile) => (
          <StatCard key={tile.key} label={tile.label} value={loading && !totals ? '-' : tile.value} note={tile.note} />
        ))}
      </div>

      {executive ? (
        <section aria-labelledby="campus-office-heading" className="space-y-3" data-testid="campus-office-table">
          <h2 id="campus-office-heading" className="title-card">By office</h2>
          <DataTable
            label="Figures by office"
            columns={officeColumns}
            data={sortedOfficeRows}
            keyExtractor={(row) => row.id}
            loading={loading && sortedOfficeRows.length === 0}
            loadingMessage="Loading…"
            emptyIcon="building"
            emptyTitle="No Office Records for This Period"
            emptySupport={label || undefined}
            emptyMessage={HOME_MESSAGES.empty}
            minWidth="40rem"
            sort={officeSort}
            onSortChange={toggleOfficeSort}
          />
        </section>
      ) : (
        <>
          <section aria-labelledby="office-staff-heading" className="space-y-3">
            <h2 id="office-staff-heading" className="title-card">{user.role === ROLES.OFFICE_HEAD ? 'By staff member' : 'Your figures'}</h2>
            <TableShell>
              <Table busy={loading} minWidth="40rem" label="Figures by staff member"
                head={<tr><Th>Staff</Th><Th align="right">Received</Th><Th align="right">On time</Th><Th align="right">Late</Th><Th align="right">On-time rate</Th><Th align="right">Pending</Th></tr>}>
                {loading && rows.length === 0 ? <TableState colSpan={6} kind="loading">Loading…</TableState> : null}
                {!loading && rows.length === 0 ? (
                  <TableState
                    colSpan={6}
                    icon="clock"
                    title="No Records for This Period"
                    supportingInfo={label || undefined}
                  >
                    {HOME_MESSAGES.empty}
                  </TableState>
                ) : null}
                {rows.map((row) => (
                  <tr key={row.id} className="tr-row">
                    <td className="td td-primary">{row.name}</td>
                    <td className="td text-right td-num">{row.received}</td>
                    <td className="td text-right td-num">{row.onTime}</td>
                    <td className="td text-right td-num">{row.late > 0 ? <span className="font-semibold text-red-700">{row.late}</span> : row.late}</td>
                    <td className="td text-right td-num">{row.rate === null ? <span className="td-muted">{HOME_MESSAGES.noRate}</span> : <span className="font-semibold">{row.rate}%</span>}</td>
                    <td className="td text-right td-num">{row.pending}</td>
                  </tr>
                ))}
              </Table>
            </TableShell>
          </section>

          <section aria-labelledby="office-pending-heading" className="space-y-3" data-testid="office-pending-list">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="office-pending-heading" className="title-card">Pending transactions (oldest first)</h2>
              <Link href="/transactions" className="text-xs font-semibold text-pup-maroon underline">View all transactions</Link>
            </div>
            <DataTable
              label="Pending transactions ordered oldest first"
              columns={pendingColumns}
              data={pendingState.items}
              keyExtractor={(row) => row.transaction_id}
              loading={pendingState.loading && pendingState.items.length === 0}
              loadingMessage="Loading pending transactions…"
              error={pendingState.error}
              emptyVariant="success"
              emptyTitle="No Open Transactions"
              emptyMessage="There are currently no open transactions requiring monitoring."
              totalCount={pendingState.loading && pendingState.items.length === 0 ? null : pendingState.total}
              countLabel="pending"
              pagination={{
                page: pendingPage,
                pageSize: pendingPageSize,
                total: pendingState.total,
                loading: pendingState.loading,
                onPage: setPendingPage,
                onPageSizeChange: (nextSize) => {
                  setPendingPageSize(nextSize);
                  setPendingPage(1);
                },
              }}
              minWidth="38rem"
            />
          </section>

          <section aria-labelledby="office-complaints-heading" className="space-y-3" data-testid="office-complaints-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="office-complaints-heading" className="title-card">Complaints</h2>
              {!complaintsState.data?.restricted ? (
                <Link href="/complaints" className="text-xs font-semibold text-pup-maroon underline">Open Complaints</Link>
              ) : null}
            </div>
            {complaintsState.error ? (
              <p className="text-sm text-slate-600">{complaintsState.error}</p>
            ) : complaintsState.data?.restricted ? (
              <p className="text-sm text-slate-600">Complaints summary is hidden under current staff permissions.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Open complaints" value={complaintsState.loading && !complaintsState.data ? '-' : (complaintsState.data?.open ?? 0)} note={complaintsState.data ? `${complaintsState.data.received} received · ${complaintsState.data.acknowledged} acknowledged` : ''} />
                <StatCard label="Overdue" value={complaintsState.loading && !complaintsState.data ? '-' : (complaintsState.data?.overdue ?? 0)} tone={complaintsState.data?.overdue ? 'danger' : 'default'} />
                <StatCard label="Acknowledged" value={complaintsState.loading && !complaintsState.data ? '-' : (complaintsState.data?.acknowledged ?? 0)} />
                <StatCard label="Resolved" value={complaintsState.loading && !complaintsState.data ? '-' : (complaintsState.data?.resolved ?? 0)} />
              </div>
            )}
          </section>
        </>
      )}
      <p className="text-xs text-slate-500">Received counts by start date; results by end date. Auto-closed transactions count as late.</p>
    </div>
  );
}
