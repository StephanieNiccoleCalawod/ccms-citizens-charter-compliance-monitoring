'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { apiFetch } from '../../lib/auth/session.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { downloadReportCsv, generateReport, getReport, listReports, publishReport, startNewVersion } from '../../lib/api/reports.js';
import { formatDate, formatDateTime } from '../../lib/ui/date-format.js';
import {
  PERIOD_TYPES, REASON_MAX, STATUS_LABEL, buildGenerateBody, canManageReports, failureMessage, figureRows,
  periodText, periodTypeLabel, publishedByText, reasonError, reportActions, versionBanner, versionText,
} from '../../lib/ui/reports.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { FieldError, RequiredMark } from '../forms/Field.js';
import FilterBar from '../forms/FilterBar.js';
import Button from '../ui/Button.js';
import StatusBadge from '../ui/StatusBadge.js';
import StatusBanner from '../feedback/StatusBanner.js';
import DataTable from '../ui/DataTable.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import RatingsSection from '../ratings/RatingsSection.js';

// Reports (CC029 / CC030 / CC031). Office Head and Super Admin generate, publish and correct; the Executive reads published reports
// of every office. Print to PDF prints the report only (see .report-print-area in globals.css).
const PAGE_SIZE = 20;
const NO_FILTERS = { officeId: '', periodType: '', status: '' };

function FiguresTable({ report }) {
  const rows = figureRows(report);
  const heads = ['Received', 'On time', 'Late', 'Closed automatically', 'On-time rate', 'Cancelled', 'Auto-closed', 'Pending now', 'Not in registry', 'Queue wait'];
  return (
    <div data-testid="report-figures">
      <TableShell>
        <Table label="Report figures" minWidth="56rem" head={<tr><Th>Service</Th>{heads.map((h) => <Th key={h} align="right">{h}</Th>)}</tr>}>
          {rows.map((r) => (
            <tr key={r.key} className={`tr-row ${r.total ? 'font-bold' : ''}`}>
              <td className="td">{r.label}</td>
              {[r.received, r.onTime, r.late, r.closedAutomatically, r.rate, r.cancelled, r.autoClosed, r.pending, r.notInRegistry, r.queueWait].map((v, i) => <td key={i} className="td text-right">{v}</td>)}
            </tr>
          ))}
        </Table>
      </TableShell>
      <p className="mt-2 text-xs text-slate-500">{report.figures?.basis}</p>
      <p className="mt-1 text-xs text-slate-500">Queue wait: minutes from taking a queue ticket to the start of the transaction, for transactions started with a ticket. It is not part of compliance.</p>
    </div>
  );
}

function ReportDetail({ report, role, onBack, onOpen, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null); // 'publish' | 'correct'
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState('');
  const actions = reportActions(report, role);
  const banner = versionBanner(report);
  const manage = canManageReports(role);

  async function run(kind, task, done) {
    setBusy(kind); setError('');
    try { const result = await task(); setConfirm(null); done(result); } catch (failure) { setError(failureMessage(failure)); setConfirm(null); } finally { setBusy(''); }
  }
  const doPublish = () => run('publish', () => publishReport(report.report_id), (r) => { setNotice(`Version ${r.version} is now published.`); onChanged(r); });
  const doCorrect = () => {
    const problem = reasonError(reason);
    setReasonProblem(problem);
    if (problem) return;
    run('correct', () => startNewVersion(report.report_id, reason.trim()), (r) => { setReason(''); onOpen(r); });
  };
  const doCsv = () => run('csv', () => downloadReportCsv(report.report_id), ({ blob, filename }) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="secondary" onClick={onBack}>Back to reports</Button>
        <div className="flex flex-wrap gap-2">
          {actions.publish ? <Button disabled={Boolean(busy)} onClick={() => setConfirm('publish')} data-testid="report-publish">Publish</Button> : null}
          {actions.correct ? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { setReasonProblem(''); setConfirm('correct'); }} data-testid="report-correct">Correct with a new version</Button> : null}
          {actions.csv ? <Button variant="secondary" disabled={Boolean(busy)} loading={busy === 'csv'} loadingLabel="Preparing CSV…" onClick={doCsv} data-testid="report-csv">Download CSV</Button> : null}
          {actions.print ? <Button variant="secondary" onClick={() => window.print()} data-testid="report-print">Print / Save as PDF</Button> : null}
        </div>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {notice ? <StatusBanner variant="success" message={notice} onDismiss={() => setNotice('')} dismissAriaLabel="Dismiss message" /> : null}
      {banner ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-300 bg-amber-50 p-3 text-sm print:hidden" role="status" data-testid="report-version-banner">
          <span>{banner.text}</span>
          {banner.targetId ? <button type="button" className="btn-link" onClick={() => onOpen({ report_id: banner.targetId })}>Open that version</button> : null}
        </div>
      ) : null}
      <article className="report-print-area card space-y-4 p-6" data-testid="report-sheet">
        <header className="border-b border-slate-200 pb-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Polytechnic University of the Philippines, Quezon City</p>
          <h2 className="title-section">Office Accomplishment Report</h2>
          <p className="text-sm font-semibold">{report.office_name ?? 'Office'}</p>
        </header>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline font-semibold">Period: </dt><dd className="inline">{periodTypeLabel(report.period_type)}, {periodText(report)}</dd></div>
          <div><dt className="inline font-semibold">Version: </dt><dd className="inline">{versionText(report).replace('Version ', '')} ({STATUS_LABEL[report.status] ?? report.status})</dd></div>
          <div><dt className="inline font-semibold">Generated: </dt><dd className="inline">{formatDateTime(report.generated_at)}</dd></div>
          {report.published_at ? <div><dt className="inline font-semibold">Published: </dt><dd className="inline" data-testid="report-published-by">{manage ? publishedByText(report) : formatDateTime(report.published_at)}</dd></div> : null}
          {report.status === 'DRAFT' ? <div className="sm:col-span-2 font-semibold text-amber-800">Draft: the figures are not official until the report is published.</div> : null}
          {report.supersede_reason ? <div className="sm:col-span-2"><dt className="inline font-semibold">Reason for this version: </dt><dd className="inline">{report.supersede_reason}</dd></div> : null}
        </dl>
        <FiguresTable report={report} />
        <RatingsSection officeId={report.office_id} from={report.period_from} to={report.period_to} />
      </article>
      <ConfirmDialog open={confirm === 'publish'} title="Publish this report?" confirmLabel="Publish" busy={busy === 'publish'} busyLabel="Publishing…" onConfirm={doPublish} onCancel={() => setConfirm(null)}
        message="Publishing freezes these figures as the official record for this office and period. A later change needs a new version with a reason." />
      <ConfirmDialog open={confirm === 'correct'} title="Correct with a new version" confirmLabel="Start new version" busy={busy === 'correct'} busyLabel="Starting…" onConfirm={doCorrect} onCancel={() => setConfirm(null)}
        message="This starts a draft with fresh figures. The published version stays official until you publish the new one.">
        <label htmlFor="report-reason" className="label mt-3">Reason for the correction<RequiredMark /></label>
        <textarea id="report-reason" className="input" aria-required="true" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(reasonProblem)} aria-describedby={reasonProblem ? 'report-reason-error' : undefined} />
        <FieldError id="report-reason-error">{reasonProblem}</FieldError>
      </ConfirmDialog>
    </div>
  );
}

export default function ReportsPage({ user }) {
  const manage = canManageReports(user.role);
  const [offices, setOffices] = useState([]);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [list, setList] = useState({ items: [], total: 0, loading: true, error: '' });
  const [report, setReport] = useState(null);
  const [opening, setOpening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const reload = useRef(0);

  useEffect(() => { apiFetch(OFFICES_API).then(({ items }) => setOffices(items ?? [])).catch(() => {}); }, []);
  const officeName = useMemo(() => new Map(offices.map((o) => [o.office_id, o.office_name])), [offices]);

  const load = useCallback(() => {
    const ticket = ++reload.current;
    setList((l) => ({ ...l, loading: true, error: '' }));
    listReports({ ...filters, page, pageSize })
      .then((data) => { if (ticket === reload.current) setList({ items: data.items ?? [], total: data.total ?? 0, loading: false, error: '' }); })
      .catch((failure) => { if (ticket === reload.current) setList({ items: [], total: 0, loading: false, error: failureMessage(failure) }); });
  }, [filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  async function open(target) {
    setOpening(true); setError('');
    try { setReport(target.figures ? target : await getReport(target.report_id)); } catch (failure) { setError(failureMessage(failure)); } finally { setOpening(false); }
  }
  const setFilter = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };

  // Generate now uses the Office and Period already chosen in the filter row (Office Head's own office, since that
  // field is hidden for them). "All offices"/"All periods" and the Custom dates period have no single report to build,
  // so each asks for a specific choice instead of silently guessing one.
  async function generate() {
    const officeId = user.role === ROLES.OFFICE_HEAD ? user.officeId : filters.officeId;
    if (!officeId) { setError('Choose an office to generate a report for.'); return; }
    if (!filters.periodType) { setError('Choose a period to generate a report for.'); return; }
    if (filters.periodType === 'custom') { setError('Custom dates are not generated from this filter; choose Half-year, Monthly, Weekly or Annual.'); return; }
    setGenerating(true); setError('');
    try {
      setReport(await generateReport(buildGenerateBody({ officeId, periodType: filters.periodType })));
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setGenerating(false);
    }
  }

  if (report) {
    return <ReportDetail key={report.report_id} report={report} role={user.role} onBack={() => { setReport(null); load(); }} onOpen={open} onChanged={(r) => { setReport(r); }} />;
  }

  const columns = [
    { key: 'office', header: 'Office', render: (r) => r.office_name ?? officeName.get(r.office_id) ?? '-' },
    { key: 'period', header: 'Period', render: (r) => `${periodTypeLabel(r.period_type)}, ${periodText(r)}` },
    { key: 'version', header: 'Version', align: 'right', render: (r) => r.version },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge variant={r.status}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge> },
    { key: 'published', header: 'Published', render: (r) => (r.published_at ? formatDate(r.published_at.slice(0, 10)) : '-') },
    { key: 'open', header: <span className="sr-only">Actions</span>, align: 'right', render: (r) => <button type="button" className="row-action" onClick={() => open(r)} disabled={opening}>Open</button> },
  ];

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <FilterBar
        label="Report filters"
        data-testid="report-filters"
        dirty={Boolean(filters.officeId || filters.periodType || filters.status)}
        onClear={() => { setFilters(NO_FILTERS); setPage(1); }}
        actions={manage ? (
          <Button className="w-full sm:w-auto" onClick={generate} loading={generating} loadingLabel="Generating…" data-testid="report-generate">
            Generate
          </Button>
        ) : null}
      >
        {user.role !== ROLES.OFFICE_HEAD ? (
          <div className="w-full sm:w-64"><label htmlFor="rf-office" className="label">Office</label>
            <select id="rf-office" className="input select-chevron" value={filters.officeId} onChange={setFilter('officeId')}>
              <option value="">All offices</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select></div>
        ) : null}
        <div className="w-full sm:w-48"><label htmlFor="rf-period" className="label">Period</label>
          <select id="rf-period" className="input select-chevron" value={filters.periodType} onChange={setFilter('periodType')}>
            <option value="">All periods</option>
            {PERIOD_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select></div>
        {manage ? (
          <div className="w-full sm:w-40"><label htmlFor="rf-status" className="label">Status</label>
            <select id="rf-status" className="input select-chevron" value={filters.status} onChange={setFilter('status')}>
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
        ) : null}
      </FilterBar>
      <DataTable label="Reports" columns={columns} data={list.items} keyExtractor={(r) => r.report_id} loading={list.loading} error={list.error || null}
        emptyMessage={manage ? 'No reports yet. Generate one above.' : 'No published reports yet.'} minWidth="44rem"
        pagination={{ page, pageSize, total: list.total, onPage: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }} />
    </div>
  );
}
