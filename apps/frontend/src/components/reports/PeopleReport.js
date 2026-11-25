'use client';

import { useEffect, useMemo, useState } from 'react';
import { getPeopleReport } from '../../lib/api/reports.js';
import { todayManila } from '../../lib/api/calendar.js';
import { formatDateRange, formatDateTime } from '../../lib/ui/date-format.js';
import {
  PEOPLE_HEADINGS, SEED_NOTE, buildPeopleQuery, complaintsNote, peopleCsv, peopleFailureMessage, peopleRows, peopleScopeText, reportCsvName, scopesFor,
} from '../../lib/ui/people-report.js';
import { ROLES } from 'ccms-shared/roles';
import ErrorBanner from '../feedback/ErrorBanner.js';
import DateHint from '../forms/DateHint.js';
import Button from '../ui/Button.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';

/**
 * S8-54 / S8-55: reports for one office, one person, or every staff member of an office, with the same print and CSV layout as the
 * office report. The server decides who may see which (Super Admin any office, Office Head their own office, Office Staff themselves).
 */
export default function PeopleReport({ user, offices }) {
  const scopes = scopesFor(user.role);
  const own = user.role === ROLES.OFFICE_STAFF;
  const today = todayManila();
  const [scope, setScope] = useState(scopes[0]?.value ?? 'person');
  const [officeId, setOfficeId] = useState(user.role === ROLES.SUPER_ADMIN ? '' : (user.officeId ?? ''));
  const [personId, setPersonId] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [people, setPeople] = useState([]); // the roster for the person picker, read with the "every staff member" scope
  const [state, setState] = useState({ loading: false, report: null, error: '' });

  const officeName = useMemo(() => offices.find((o) => o.office_id === (user.role === ROLES.SUPER_ADMIN ? officeId : user.officeId))?.office_name ?? '', [offices, officeId, user]);

  // The person picker lists the staff of the chosen office. It is read the same way as the report (server-checked).
  useEffect(() => {
    if (scope !== 'person' || own) return undefined;
    const office = user.role === ROLES.SUPER_ADMIN ? officeId : user.officeId;
    if (!office) return undefined;
    let cancelled = false;
    getPeopleReport({ scope: 'all_staff', officeId: office, from: today, to: today })
      .then((data) => !cancelled && setPeople((data.items ?? []).filter((p) => p.person_id)))
      .catch(() => !cancelled && setPeople([]));
    return () => { cancelled = true; };
  }, [scope, officeId, own, user, today]);

  async function run(event) {
    event.preventDefault();
    const query = buildPeopleQuery({ role: user.role, scope, officeId, personId, from, to, user });
    if (query.error) { setState({ loading: false, report: null, error: query.error }); return; }
    setState({ loading: true, report: null, error: '' });
    try {
      setState({ loading: false, report: await getPeopleReport(query), error: '' });
    } catch (failure) {
      setState({ loading: false, report: null, error: peopleFailureMessage(failure) });
    }
  }

  function download() {
    const blob = new Blob([peopleCsv(state.report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = reportCsvName(officeName, state.report.generated_at?.slice(0, 10) ?? today);
    link.click();
    URL.revokeObjectURL(url);
  }

  const report = state.report;
  const rows = peopleRows(report);
  const personName = people.find((p) => p.person_id === personId)?.person_name ?? report?.items?.[0]?.person_name ?? '';

  return (
    <section className="space-y-3" aria-labelledby="people-report-heading" data-testid="people-report">
      <div className="print:hidden">
        <h2 id="people-report-heading" className="text-base font-semibold text-slate-900">Reports by person</h2>
        <p className="text-sm text-slate-500">See the work of your office, of one person, or of every staff member for the dates you choose.</p>
      </div>
      <form onSubmit={run} className="card flex flex-wrap items-end gap-3 p-4 print:hidden" aria-label="Report by person">
        {!own ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-scope" className="label">Report for</label>
            <select id="pr-scope" className="input select-chevron" value={scope} onChange={(e) => { setScope(e.target.value); setPersonId(''); }}>
              {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        ) : null}
        {user.role === ROLES.SUPER_ADMIN ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-office" className="label">Office</label>
            <select id="pr-office" className="input select-chevron" value={officeId} onChange={(e) => { setOfficeId(e.target.value); setPersonId(''); }}>
              <option value="">Choose an office</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select>
          </div>
        ) : null}
        {scope === 'person' && !own ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-person" className="label">Person</label>
            <select id="pr-person" className="input select-chevron" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose a person</option>
              {people.map((p) => <option key={p.person_id} value={p.person_id}>{p.person_name || 'Name not available'}</option>)}
            </select>
          </div>
        ) : null}
        <div className="w-full sm:w-44">
          <label htmlFor="pr-from" className="label">From</label>
          <input id="pr-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-describedby="pr-from-hint" />
          <DateHint id="pr-from-hint" />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="pr-to" className="label">To</label>
          <input id="pr-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-describedby="pr-to-hint" />
          <DateHint id="pr-to-hint" />
        </div>
        <Button type="submit" loading={state.loading} loadingLabel="Loading…" data-testid="people-run">Show report</Button>
      </form>
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: '' }))} />
      {report ? (
        <>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" onClick={download} data-testid="people-csv">Download CSV</Button>
            <Button variant="secondary" onClick={() => window.print()} data-testid="people-print">Print / Save as PDF</Button>
          </div>
          <article className="report-print-area card space-y-3 p-6" data-testid="people-sheet">
            <header className="border-b border-slate-200 pb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Polytechnic University of the Philippines, Quezon City</p>
              <h3 className="title-section">Staff Accomplishment Report</h3>
              <p className="text-sm font-semibold">{peopleScopeText(report, officeName, personName)}</p>
            </header>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline font-semibold">Period: </dt><dd className="inline">{formatDateRange(report.from, report.to)}</dd></div>
              <div><dt className="inline font-semibold">Generated: </dt><dd className="inline">{formatDateTime(report.generated_at)}</dd></div>
              <div><dt className="inline font-semibold">Generated by: </dt><dd className="inline">{user.fullName}</dd></div>
            </dl>
            <TableShell>
              <Table label="Report by person" minWidth="56rem" head={<tr><Th>Person</Th>{PEOPLE_HEADINGS.map((h) => <Th key={h} align="right">{h}</Th>)}</tr>}>
                {rows.map((r) => (
                  <tr key={r.key} className={r.key === 'total' ? 'tr-summary font-bold' : 'tr-row'}>
                    <td className="td">{r.label}</td>
                    {[r.handled, r.onTime, r.late, r.typical, r.paused, r.autoClosed, r.cancelled, r.open, r.rating, r.complaints].map((v, i) => <td key={i} className="td text-right tabular-nums">{v}</td>)}
                  </tr>
                ))}
              </Table>
            </TableShell>
            <p className="text-xs text-ink-muted">{SEED_NOTE}{report.excluded_seed_count > 0 ? ` (${report.excluded_seed_count.toLocaleString('en-PH')} left out.)` : ''}</p>
            <p className="text-xs text-ink-muted">{report.basis}</p>
            <p className="text-xs text-ink-muted">{complaintsNote(report)}</p>
          </article>
        </>
      ) : null}
    </section>
  );
}
