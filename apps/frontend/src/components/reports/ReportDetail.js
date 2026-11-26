'use client';

import { useState } from 'react';
import { downloadReportCsv, publishReport, startNewVersion } from '../../lib/api/reports.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import {
  REASON_MAX, STATUS_LABEL, canManageReports, failureMessage, figureRows, periodSentence, publishedByText, reasonError, reportActions, versionBanner, versionText,
} from '../../lib/ui/reports.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { FieldError, RequiredMark } from '../forms/Field.js';
import Button from '../ui/Button.js';
import StatusBanner from '../feedback/StatusBanner.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';
import RatingsSection from '../ratings/RatingsSection.js';
import LockedNotice from '../access/LockedNotice.js';
import { canRequestAccess } from '../../lib/ui/access.js';
import SignatureLines from './SignatureLines.js';

function FiguresTable({ report }) {
  const rows = figureRows(report);
  const heads = ['Received', 'On time', 'Late', 'Closed automatically', 'On-time rate', 'Cancelled', 'Auto-closed', 'Pending now', 'Not in registry', 'Queue wait'];
  return (
    <div data-testid="report-figures">
      <TableShell>
        <Table label="Report figures" minWidth="56rem" head={<tr><Th>Service</Th>{heads.map((h) => <Th key={h} align="right">{h}</Th>)}</tr>}>
          {rows.map((r) => (
            <tr key={r.key} className={r.total ? 'tr-summary font-bold' : 'tr-row'}>
              <td className="td">{r.label}</td>
              {[r.received, r.onTime, r.late, r.closedAutomatically, r.rate, r.cancelled, r.autoClosed, r.pending, r.notInRegistry, r.queueWait].map((v, i) => <td key={i} className="td text-right tabular-nums">{v}</td>)}
            </tr>
          ))}
        </Table>
      </TableShell>
      <p className="mt-2 text-xs text-ink-muted">{report.figures?.basis}</p>
      <p className="mt-1 text-xs text-ink-muted">Queue wait: minutes from taking a queue ticket to the start of the transaction, for transactions started with a ticket. It is not part of compliance.</p>
    </div>
  );
}

/** The office report sheet (CC029 / CC030 / CC031), shown on the dedicated report page (/reports/view) whether
 * the report was just generated or opened from the reports list. */
export default function ReportDetail({ report, role, generatedBy, onBack, onOpen, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false); // the CSV download was refused for lack of access (S8-52)
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null); // 'publish' | 'correct'
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState('');
  const actions = reportActions(report, role);
  const banner = versionBanner(report);
  const manage = canManageReports(role);

  async function run(kind, task, done) {
    setBusy(kind); setError(''); setLocked(false);
    try { const result = await task(); setConfirm(null); done(result); } catch (failure) { setError(failureMessage(failure)); setLocked(kind === 'csv' && failure?.status === 403); setConfirm(null); } finally { setBusy(''); }
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
        <Button variant="secondary" onClick={onBack} data-testid="report-back">Back to reports</Button>
        <div className="flex flex-wrap gap-2">
          {actions.publish ? <Button disabled={Boolean(busy)} onClick={() => setConfirm('publish')} data-testid="report-publish">Publish</Button> : null}
          {actions.correct ? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { setReasonProblem(''); setConfirm('correct'); }} data-testid="report-correct">Correct with a new version</Button> : null}
          {actions.csv ? <Button variant="secondary" disabled={Boolean(busy)} loading={busy === 'csv'} loadingLabel="Preparing CSV…" onClick={doCsv} data-testid="report-csv">Download CSV</Button> : null}
          {actions.print ? <Button variant="secondary" onClick={() => window.print()} data-testid="report-print">Print / Save as PDF</Button> : null}
        </div>
      </div>
      {locked && canRequestAccess(role)
        ? <LockedNotice permissionKey="EXPORT_CSV" role={role} message="You don’t have access to download CSV yet." />
        : <ErrorBanner message={error} onDismiss={() => setError('')} />}
      {notice ? <StatusBanner variant="success" message={notice} onDismiss={() => setNotice('')} dismissAriaLabel="Dismiss message" /> : null}
      {banner ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-300 bg-amber-50 p-3 text-sm print:hidden" role="status" data-testid="report-version-banner">
          <span>{banner.text}</span>
          {banner.targetId ? <button type="button" className="btn-link" onClick={() => onOpen({ report_id: banner.targetId })}>Open that version</button> : null}
        </div>
      ) : null}
      <article className="report-print-area card space-y-4 p-6" data-testid="report-sheet">
        <header className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <img src="/pup-logo.png" alt="" className="h-12 w-12 shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Polytechnic University of the Philippines, Quezon City</p>
            <h2 className="title-section">Office Accomplishment Report</h2>
            <p className="text-sm font-semibold">{report.office_name ?? 'Office'}</p>
          </div>
        </header>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline font-semibold">Period: </dt><dd className="inline">{periodSentence(report)}</dd></div>
          <div><dt className="inline font-semibold">Version: </dt><dd className="inline">{versionText(report).replace('Version ', '')} ({STATUS_LABEL[report.status] ?? report.status})</dd></div>
          <div><dt className="inline font-semibold">Generated: </dt><dd className="inline">{formatDateTime(report.generated_at)}</dd></div>
          {generatedBy ? <div><dt className="inline font-semibold">Printed by: </dt><dd className="inline">{generatedBy}</dd></div> : null}
          {report.published_at ? <div><dt className="inline font-semibold">Published: </dt><dd className="inline" data-testid="report-published-by">{manage ? publishedByText(report) : formatDateTime(report.published_at)}</dd></div> : null}
          {report.status === 'DRAFT' ? <div className="sm:col-span-2 font-semibold text-amber-800">Draft: the figures are not official until the report is published.</div> : null}
          {report.supersede_reason ? <div className="sm:col-span-2"><dt className="inline font-semibold">Reason for this version: </dt><dd className="inline">{report.supersede_reason}</dd></div> : null}
        </dl>
        <FiguresTable report={report} />
        <RatingsSection officeId={report.office_id} from={report.period_from} to={report.period_to} />
        <SignatureLines />
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
