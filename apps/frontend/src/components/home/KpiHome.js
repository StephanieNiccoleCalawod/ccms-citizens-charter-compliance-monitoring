'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { getAccountNames, getKpis, getOfficeNames } from '../../lib/api/kpis.js';
import { DEFAULT_PERIOD, HOME_MESSAGES, PERIOD_OPTIONS, failureMessage, groupByFor, officeRows, periodLabel, staffRows, tilesFor } from '../../lib/ui/kpi-home.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import TableState from '../ui/TableState.js';
import StatCard from '../ui/StatCard.js';

// The home screen of Office Head / Office Staff (CC036) and of the Executive (CC037): the KPI tiles for a period, a table below,
// and a link to Insights. The Executive never gets a per-staff table (the server refuses it as well).
export default function KpiHome({ user }) {
  const executive = user.role === ROLES.EXECUTIVE;
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [state, setState] = useState({ status: 'loading', answer: null, error: '' });
  const [totals, setTotals] = useState(null);
  const [names, setNames] = useState(new Map());

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
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
      setNames(new Map([[user.id, user.fullName]]));
    }
    return () => { active = false; };
  }, [executive, user.role, user.id, user.fullName]);

  const tiles = useMemo(() => tilesFor(totals), [totals]);
  const rows = useMemo(() => (executive ? officeRows(state.answer?.groups, names) : staffRows(state.answer?.groups, names)), [executive, state.answer, names]);
  const loading = state.status === 'loading';
  const label = periodLabel(state.answer);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="kpi-period" className="label">Period</label>
          <select id="kpi-period" className="input select-chevron" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4">
          {label ? <p className="text-xs text-slate-500" data-testid="kpi-period-range">{label}</p> : null}
          <Link href="/" className="btn-secondary" data-testid="kpi-insights-link">Open Insights</Link>
        </div>
      </div>
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: '' }))} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="kpi-tiles" aria-busy={loading}>
        {tiles.map((tile) => (
          <StatCard key={tile.key} label={tile.label} value={loading && !totals ? '-' : tile.value} note={tile.note} />
        ))}
      </div>
      <h2 className="title-card">{executive ? 'By office' : user.role === ROLES.OFFICE_HEAD ? 'By staff member' : 'Your figures'}</h2>
      <TableShell>
        <Table busy={loading} minWidth="40rem" label={executive ? 'Figures by office' : 'Figures by staff member'}
          head={<tr><Th>{executive ? 'Office' : 'Staff'}</Th><Th align="right">Received</Th><Th align="right">On time</Th><Th align="right">Late</Th><Th align="right">On-time rate</Th><Th align="right">Pending</Th></tr>}>
          {loading && rows.length === 0 ? <TableState colSpan={6} kind="loading">Loading…</TableState> : null}
          {!loading && rows.length === 0 ? <TableState colSpan={6}>{HOME_MESSAGES.empty}</TableState> : null}
          {rows.map((row) => (
            <tr key={row.id} className="tr-row">
              <td className="td">{row.name}</td>
              <td className="td text-right">{row.received}</td>
              <td className="td text-right">{row.onTime}</td>
              <td className="td text-right">{row.late}</td>
              <td className="td text-right">{row.rate === null ? HOME_MESSAGES.noRate : `${row.rate}%`}</td>
              <td className="td text-right">{row.pending}</td>
            </tr>
          ))}
        </Table>
      </TableShell>
      <p className="text-xs text-slate-500">Received counts by start date; results by end date. Auto-closed transactions count as late.</p>
    </div>
  );
}
