'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { apiFetch } from '../../lib/auth/session.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { generateReport, getReport, listReports } from '../../lib/api/reports.js';
import { formatDate, formatDateRange } from '../../lib/ui/date-format.js';
import {
  PERIOD_ANCHOR_HINT, PERIOD_TYPES, STATUS_LABEL, buildGenerateBody, canManageReports, failureMessage, generateErrors,
  periodBounds, periodText, periodTypeLabel,
} from '../../lib/ui/reports.js';
import { usePersistentState } from '../../lib/ui/persistent-state.js';
import { setViewedReport } from '../../lib/ui/report-view-store.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { RequiredMark } from '../forms/Field.js';
import FilterBar from '../forms/FilterBar.js';
import Button from '../ui/Button.js';
import Modal from '../modals/Modal.js';
import StatusBadge from '../ui/StatusBadge.js';
import DataTable from '../ui/DataTable.js';
import PeopleReport from './PeopleReport.js';
import TermPeriodOptions, { useTerms } from '../forms/TermPeriodOptions.js';
import { isTermChoice, termPeriodText } from '../../lib/ui/term-period.js';
import { canSeePeopleReport } from '../../lib/ui/people-report.js';

// Reports (CC029 / CC030 / CC031). Office Head and Super Admin generate, publish and correct; the Executive reads
// published reports of every office. One shared Generate Report modal covers both the official office report and
// Report by Person (PeopleReport.js, reused here rather than re-implemented) behind a Report Type choice; there is
// no separate "Reports by person" section on this page any more. Generate Report and Open both land on the
// dedicated /reports/view page (see ReportView.js); this page is the list, the Status filter and the modal, and
// its state survives the round trip there and back (see usePersistentState).
const PAGE_SIZE = 20;
const NO_DRAFT = { officeId: '', periodType: 'weekly', date: '', from: '', to: '' };

export default function ReportsPage({ user }) {
  const manage = canManageReports(user.role);
  const router = useRouter();
  const [offices, setOffices] = useState([]);
  const [filters, setFilters] = usePersistentState('reports-page:filters', { status: '' }); // the listing's own filter: Status only
  const [page, setPage] = usePersistentState('reports-page:page', 1);
  const [pageSize, setPageSize] = usePersistentState('reports-page:pageSize', PAGE_SIZE);
  const [list, setList] = useState({ items: [], total: 0, loading: true, error: '' });
  const [opening, setOpening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [personFormState, setPersonFormState] = useState({ loading: false, canSubmit: false });
  const [reportFor, setReportFor] = usePersistentState('reports-page:reportFor', 'office'); // 'office' | 'person': which fields the modal shows
  const [draft, setDraft] = usePersistentState('reports-page:draft', NO_DRAFT); // Office/Period and its date(s), applied only on Generate Report
  const [genError, setGenError] = useState('');
  const reload = useRef(0);
  const termState = useTerms();
  const generateButtonRef = useRef(null);
  const seesPeopleReport = canSeePeopleReport(user.role);
  // Office Staff cannot manage (generate) office reports but can still see their own Report by Person, so the
  // Generate Report button and modal exist whenever either is true. The Report Type choice itself only makes
  // sense when both are available; otherwise there is only one kind of report this role could generate.
  const canChooseReportType = manage && seesPeopleReport;
  const effectiveReportFor = canChooseReportType ? reportFor : (manage ? 'office' : 'person');

  useEffect(() => { apiFetch(OFFICES_API).then(({ items }) => setOffices(items ?? [])).catch(() => {}); }, []);
  const officeName = useMemo(() => new Map(offices.map((o) => [o.office_id, o.office_name])), [offices]);

  const load = useCallback(() => {
    const ticket = ++reload.current;
    setList((l) => ({ ...l, loading: true, error: '' }));
    listReports({ status: filters.status, page, pageSize })
      .then((data) => { if (ticket === reload.current) setList({ items: data.items ?? [], total: data.total ?? 0, loading: false, error: '' }); })
      .catch((failure) => { if (ticket === reload.current) setList({ items: [], total: 0, loading: false, error: failureMessage(failure) }); });
  }, [filters, page, pageSize]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the list again when the filters or page change
  useEffect(() => { load(); }, [load]);

  // Opening an existing report from the table: fetch it (if the row did not already carry its figures), hand it
  // to the dedicated report page, and navigate there - the list and its Status filter stay exactly as they are.
  async function open(target) {
    setOpening(true); setError('');
    try {
      const full = target.figures ? target : await getReport(target.report_id);
      setViewedReport({ kind: 'office', report: full, generatedBy: user.fullName });
      router.push('/reports/view');
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setOpening(false);
    }
  }
  const setDraftField = (key) => (event) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  function openGenerateModal() {
    setGenError('');
    setReportModalOpen(true);
  }

  const genOfficeId = user.role === ROLES.OFFICE_HEAD ? user.officeId : draft.officeId;
  const needsAnchorDate = !isTermChoice(draft.periodType) && draft.periodType !== 'custom';
  // Weekly/Monthly/Half-year/Annual are always generated from a computed, non-custom range (Oversight only ever
  // resolves those four kinds of period from one anchor date, never an arbitrary pair - see periodBounds), so From
  // and To there show that computed range rather than two independently free dates; only Custom dates and a term
  // or school year choice are exempt from this (a term/school year needs neither). Nothing is computed, and the
  // range stays blank, until a reference date is actually chosen - it is never silently defaulted to today.
  const bounds = needsAnchorDate && draft.date ? periodBounds(draft.periodType, draft.date) : null;
  const fieldErrors = generateErrors({
    officeId: genOfficeId,
    periodType: draft.periodType,
    from: draft.periodType === 'custom' ? draft.from : bounds?.from,
    to: draft.periodType === 'custom' ? draft.to : bounds?.to,
    dateRequired: needsAnchorDate,
  });
  const canGenerate = Object.keys(fieldErrors).length === 0;

  // The line shown before Generate Report: the exact range about to be generated, written out in full
  // ("November 23–29, 2026"), or the term/school year's own wording when that is what was chosen.
  const previewText = useMemo(() => {
    if (isTermChoice(draft.periodType)) return termPeriodText(draft.periodType, termState.terms);
    if (draft.periodType === 'custom') return draft.from && draft.to && draft.from <= draft.to ? formatDateRange(draft.from, draft.to) : '';
    return bounds ? formatDateRange(bounds.from, bounds.to) : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bounds is derived from draft.periodType/date each render
  }, [draft.periodType, draft.date, draft.from, draft.to, termState.terms, bounds]);

  // Generates the official office report for exactly what the dialog shows: the chosen office, and either the
  // period type with its computed range, Custom dates' From/To, or a term/school year. On success the dialog
  // closes and the new report is shown on the dedicated report page, not inline here.
  async function generate() {
    if (!canGenerate) { setGenError(Object.values(fieldErrors)[0]); return; }
    setGenerating(true); setGenError('');
    try {
      const result = await generateReport(buildGenerateBody({
        officeId: genOfficeId,
        periodType: draft.periodType,
        date: !isTermChoice(draft.periodType) && draft.periodType !== 'custom' ? (draft.date || undefined) : undefined,
        from: draft.periodType === 'custom' ? draft.from : undefined,
        to: draft.periodType === 'custom' ? draft.to : undefined,
      }));
      setReportModalOpen(false);
      setPage(1);
      setViewedReport({ kind: 'office', report: result, generatedBy: user.fullName });
      router.push('/reports/view');
    } catch (failure) {
      setGenError(failureMessage(failure));
    } finally {
      setGenerating(false);
    }
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
        label="Report actions"
        data-testid="report-filters"
        actions={manage || seesPeopleReport ? (
          <Button
            ref={generateButtonRef}
            className="w-full sm:w-auto"
            onClick={openGenerateModal}
            loading={generating}
            loadingLabel="Generating…"
            data-testid="report-generate"
          >
            Generate Report
          </Button>
        ) : null}
      >
        <div className="w-full sm:w-56">
          <label htmlFor="report-status-filter" className="label">Status</label>
          <select id="report-status-filter" className="input select-chevron" value={filters.status}
            onChange={(event) => { setFilters({ status: event.target.value }); setPage(1); }}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </FilterBar>
      <DataTable label="Reports" columns={columns} data={list.items} keyExtractor={(r) => r.report_id} loading={list.loading} error={list.error || null}
        emptyMessage={manage ? 'No reports yet. Generate one above.' : 'No published reports yet.'} minWidth="44rem"
        pagination={{ page, pageSize, total: list.total, onPage: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }} />
      {manage || seesPeopleReport ? (
        <Modal
          open={reportModalOpen}
          onClose={generating || personFormState.loading ? undefined : () => setReportModalOpen(false)}
          title={effectiveReportFor === 'person' ? 'Report by person' : 'Generate office report'}
          showClose={!generating && !personFormState.loading}
          returnFocusRef={generateButtonRef}
          footer={
            effectiveReportFor === 'person' ? (
              <>
                <Button variant="secondary" onClick={() => setReportModalOpen(false)} disabled={personFormState.loading}>Cancel</Button>
                <Button type="submit" form="people-report-form" loading={personFormState.loading} loadingLabel="Generating…" disabled={!personFormState.canSubmit} data-testid="people-run">Generate Report</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setReportModalOpen(false)} disabled={generating}>Cancel</Button>
                <Button onClick={generate} loading={generating} loadingLabel="Generating…" disabled={!canGenerate} data-testid="report-generate-confirm">Generate Report</Button>
              </>
            )
          }
        >
          <div className="space-y-4">
            {canChooseReportType ? (
              <div className="w-full sm:w-64">
                <label htmlFor="rf-report-for" className="label">Report Type<RequiredMark /></label>
                <select
                  id="rf-report-for"
                  className="input select-chevron"
                  value={reportFor}
                  onChange={(event) => setReportFor(event.target.value)}
                  data-testid="report-for"
                >
                  <option value="office">Office Report</option>
                  <option value="person">Report by Person</option>
                </select>
              </div>
            ) : null}

            {effectiveReportFor === 'person' ? (
              <PeopleReport
                user={user}
                offices={offices}
                hideHeading
                compact
                persistKey="modal"
                formId="people-report-form"
                onStateChange={setPersonFormState}
                onGenerated={() => setReportModalOpen(false)}
              />
            ) : (
              <>
                <ErrorBanner message={genError} onDismiss={() => setGenError('')} />
                <div className="flex flex-wrap gap-4">
                  {user.role !== ROLES.OFFICE_HEAD ? (
                    <div className="w-full sm:w-64"><label htmlFor="rf-office" className="label">Office<RequiredMark /></label>
                      <select id="rf-office" className="input select-chevron" value={draft.officeId} onChange={setDraftField('officeId')}>
                        <option value="">Choose an office</option>
                        {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
                      </select></div>
                  ) : null}
                  <div className="w-full sm:w-64"><label htmlFor="rf-period" className="label">Period type<RequiredMark /></label>
                    <select id="rf-period" className="input select-chevron" value={draft.periodType} onChange={setDraftField('periodType')}>
                      {PERIOD_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      <TermPeriodOptions terms={termState.terms} />
                    </select>
                  </div>
                  {!isTermChoice(draft.periodType) ? (
                    <div className="flex w-full flex-col gap-4 sm:flex-row">
                      <div className="min-w-0 flex-1"><label htmlFor="rf-from" className="label">From<RequiredMark /></label>
                        <input id="rf-from" type="date" className="input" aria-describedby="rf-from-hint"
                          value={draft.periodType === 'custom' ? draft.from : (bounds?.from ?? '')}
                          max={draft.periodType === 'custom' ? (draft.to || undefined) : undefined}
                          onChange={draft.periodType === 'custom' ? setDraftField('from') : setDraftField('date')} />
                        <p id="rf-from-hint" className="mt-1 text-xs text-slate-500">{draft.periodType === 'custom' ? 'MM/DD/YYYY' : PERIOD_ANCHOR_HINT[draft.periodType]}</p></div>
                      <div className="min-w-0 flex-1"><label htmlFor="rf-to" className="label">To<RequiredMark /></label>
                        <input id="rf-to" type="date" className="input" aria-describedby="rf-to-hint"
                          value={draft.periodType === 'custom' ? draft.to : (bounds?.to ?? '')}
                          min={draft.periodType === 'custom' ? (draft.from || undefined) : undefined}
                          disabled={draft.periodType !== 'custom'}
                          onChange={draft.periodType === 'custom' ? setDraftField('to') : undefined} />
                        <p id="rf-to-hint" className="mt-1 text-xs text-slate-500">{draft.periodType === 'custom' ? 'MM/DD/YYYY' : 'The end date is automatically calculated based on the selected period.'}</p></div>
                    </div>
                  ) : null}
                </div>
                {previewText ? <p className="text-sm text-slate-600" data-testid="report-generate-preview">{previewText}</p> : null}
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
