'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getReport } from '../../lib/api/reports.js';
import { failureMessage } from '../../lib/ui/reports.js';
import { peopleCsv, reportCsvName } from '../../lib/ui/people-report.js';
import { getViewedReport, setViewedReport } from '../../lib/ui/report-view-store.js';
import Button from '../ui/Button.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import ReportDetail from './ReportDetail.js';
import PeopleReportSheet from './PeopleReportSheet.js';

function OfficeReportView({ user, entry, router }) {
  const [report, setReport] = useState(entry.report);
  const [error, setError] = useState('');

  // "Open that version" (the superseded/correction banner) and "Correct with a new version" both hand this a
  // report to show next; this stays on the same page (/reports/view) instead of navigating again.
  async function onOpen(target) {
    setError('');
    try {
      const full = target.figures ? target : await getReport(target.report_id);
      setViewedReport({ kind: 'office', report: full, generatedBy: entry.generatedBy });
      setReport(full);
    } catch (failure) {
      setError(failureMessage(failure));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <ReportDetail
        key={report.report_id}
        report={report}
        role={user.role}
        generatedBy={entry.generatedBy}
        onBack={() => router.back()}
        onOpen={onOpen}
        onChanged={(r) => { setViewedReport({ kind: 'office', report: r, generatedBy: entry.generatedBy }); setReport(r); }}
      />
    </div>
  );
}

function PeopleReportView({ entry, router }) {
  const { report, officeName, personName, generatedBy } = entry;

  function download() {
    const blob = new Blob([peopleCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = reportCsvName(officeName, report.generated_at?.slice(0, 10) ?? '');
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="secondary" onClick={() => router.back()} data-testid="report-back">Back to reports</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={download} data-testid="people-csv">Download CSV</Button>
          <Button variant="secondary" onClick={() => window.print()} data-testid="people-print">Print / Save as PDF</Button>
        </div>
      </div>
      <PeopleReportSheet report={report} officeName={officeName} personName={personName} generatedBy={generatedBy} />
    </div>
  );
}

/** The dedicated report page (/reports/view): whatever the Reports page just generated or opened (office or
 * person), handed off in memory (see report-view-store.js). Not reachable on its own - a direct load or a
 * refresh here has nothing to show, so it sends the person back to /reports instead of guessing a report. */
export default function ReportView({ user }) {
  const router = useRouter();
  const [entry] = useState(() => getViewedReport());

  if (!entry) {
    return (
      <div className="card space-y-3 p-6 text-sm text-slate-600">
        <p>There is no report to show. Generate or open one from the Reports page.</p>
        <Button variant="secondary" onClick={() => router.push('/reports')}>Back to reports</Button>
      </div>
    );
  }

  if (entry.kind === 'person') return <PeopleReportView entry={entry} router={router} />;
  return <OfficeReportView user={user} entry={entry} router={router} />;
}
