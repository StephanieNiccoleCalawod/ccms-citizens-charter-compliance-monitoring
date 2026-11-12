'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import { apiFetch } from '../../lib/auth/session.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { acknowledgeComplaint, getComplaintForStaff, listComplaintsForStaff, resolveComplaint } from '../../lib/api/complaint-handling.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { notify } from '../../lib/ui/notify.js';
import { REPLY_MAX, STATUS_FILTERS, STATUS_LABEL, canHandleComplaints, complaintActions, dueText, failureMessage, replyError, seesContact, statusText } from '../../lib/ui/complaint-handling.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import DataTable from '../ui/DataTable.js';

// Complaints (CC034 / CC035). Super Admin and Office Head acknowledge and resolve (a written reply is required); the Executive and Office
// Staff read. A complaint that is past its due date and not resolved is shown in red.
const PAGE_SIZE = 20;
const Overdue = ({ show }) => (show ? <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800" data-testid="complaint-overdue">Overdue</span> : null);

function Detail({ complaint, role, onBack, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reply, setReply] = useState('');
  const [problem, setProblem] = useState('');
  const actions = complaintActions(complaint, role);

  async function acknowledge() {
    setBusy('ack'); setError('');
    try { onChanged(await acknowledgeComplaint(complaint.complaint_id)); notify.success('Complaint acknowledged.'); } catch (failure) { setError(failureMessage(failure)); } finally { setBusy(''); }
  }
  async function resolve() {
    const found = replyError(reply);
    setProblem(found);
    if (found) return;
    setBusy('resolve'); setError('');
    try { onChanged(await resolveComplaint(complaint.complaint_id, reply.trim())); setConfirm(false); setReply(''); notify.success('Complaint resolved.'); } catch (failure) { setError(failureMessage(failure)); setConfirm(false); } finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-secondary" onClick={onBack}>Back to complaints</button>
        <div className="flex gap-2">
          {actions.acknowledge ? <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={acknowledge} data-testid="complaint-acknowledge">{busy === 'ack' ? 'Acknowledging…' : 'Acknowledge'}</button> : null}
          {actions.resolve ? <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={() => { setProblem(''); setConfirm(true); }} data-testid="complaint-resolve">Resolve with a reply</button> : null}
        </div>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <article className={`card space-y-3 p-6 ${complaint.overdue ? 'border-red-400' : ''}`} data-testid="complaint-sheet">
        <header className="border-b border-slate-200 pb-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Complaint</p>
          <h2 className="text-lg font-bold text-maroon-950">{complaint.reference}</h2>
        </header>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline font-semibold">Status: </dt><dd className="inline" data-testid="complaint-status">{STATUS_LABEL[complaint.status] ?? complaint.status}</dd><Overdue show={complaint.overdue} /></div>
          <div><dt className="inline font-semibold">Category: </dt><dd className="inline">{complaint.category_label}</dd></div>
          <div><dt className="inline font-semibold">Filed: </dt><dd className="inline">{formatDateTime(complaint.created_at)}</dd></div>
          <div><dt className="inline font-semibold">Due: </dt><dd className={`inline ${complaint.overdue ? 'font-bold text-red-800' : ''}`}>{dueText(complaint)}</dd></div>
          {complaint.tracking_no ? <div><dt className="inline font-semibold">Transaction number: </dt><dd className="inline">{complaint.tracking_no}</dd></div> : null}
          {complaint.acknowledged_at ? <div><dt className="inline font-semibold">Acknowledged: </dt><dd className="inline">{formatDateTime(complaint.acknowledged_at)}</dd></div> : null}
          {complaint.resolved_at ? <div><dt className="inline font-semibold">Resolved: </dt><dd className="inline">{formatDateTime(complaint.resolved_at)}</dd></div> : null}
          {seesContact(role) ? (
            <>
              <div><dt className="inline font-semibold">Name: </dt><dd className="inline">{complaint.complainant_name || 'Not given'}</dd></div>
              <div><dt className="inline font-semibold">Email: </dt><dd className="inline">{complaint.complainant_email || 'Not given'}</dd></div>
            </>
          ) : null}
        </dl>
        <section><h3 className="text-sm font-semibold">What the citizen wrote</h3><p className="mt-1 whitespace-pre-wrap text-sm" data-testid="complaint-description">{complaint.description}</p></section>
        {complaint.reply ? <section><h3 className="text-sm font-semibold">Reply</h3><p className="mt-1 whitespace-pre-wrap text-sm" data-testid="complaint-reply">{complaint.reply}</p></section> : null}
      </article>
      <ConfirmDialog open={confirm} title="Resolve this complaint" confirmLabel="Resolve" busy={busy === 'resolve'} busyLabel="Resolving…" onConfirm={resolve} onCancel={() => setConfirm(false)}
        message="Write the reply to the complaint. A resolved complaint cannot be reopened.">
        <label htmlFor="complaint-reply" className="label mt-3">Reply</label>
        <textarea id="complaint-reply" className="input" rows={5} maxLength={REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} aria-invalid={Boolean(problem)} aria-describedby={problem ? 'complaint-reply-error' : undefined} />
        {problem ? <p id="complaint-reply-error" className="mt-1 text-xs text-red-700">{problem}</p> : null}
      </ConfirmDialog>
    </div>
  );
}

export default function ComplaintsPage({ user }) {
  const [offices, setOffices] = useState([]);
  const [filters, setFilters] = useState({ officeId: '', status: '', overdue: false });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [list, setList] = useState({ items: [], total: 0, loading: true, error: '' });
  const [complaint, setComplaint] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const reload = useRef(0);
  const ownOffice = user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF;

  useEffect(() => { if (!ownOffice) apiFetch(OFFICES_API).then(({ items }) => setOffices(items ?? [])).catch(() => {}); }, [ownOffice]);
  const officeName = useMemo(() => new Map(offices.map((o) => [o.office_id, o.office_name])), [offices]);

  const load = useCallback(() => {
    const ticket = ++reload.current;
    setList((l) => ({ ...l, loading: true, error: '' }));
    listComplaintsForStaff({ ...filters, page, pageSize })
      .then((data) => { if (ticket === reload.current) setList({ items: data.items ?? [], total: data.total ?? 0, loading: false, error: '' }); })
      .catch((failure) => { if (ticket === reload.current) setList({ items: [], total: 0, loading: false, error: failureMessage(failure) }); });
  }, [filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  async function open(target) {
    setOpening(true); setError('');
    try { setComplaint(await getComplaintForStaff(target.complaint_id)); } catch (failure) { setError(failureMessage(failure)); } finally { setOpening(false); }
  }
  const setFilter = (key) => (event) => { setPage(1); setFilters((f) => ({ ...f, [key]: event.target.value })); };

  if (complaint) return <Detail key={complaint.complaint_id} complaint={complaint} role={user.role} onBack={() => { setComplaint(null); load(); }} onChanged={setComplaint} />;

  const columns = [
    { key: 'reference', header: 'Reference', render: (c) => c.reference },
    ...(ownOffice ? [] : [{ key: 'office', header: 'Office', render: (c) => officeName.get(c.office_id) ?? '-' }]),
    { key: 'category', header: 'Category', render: (c) => c.category_label },
    { key: 'filed', header: 'Filed', render: (c) => formatDateTime(c.created_at) },
    { key: 'due', header: 'Due', render: (c) => <span className={c.overdue ? 'font-bold text-red-800' : ''}>{dueText(c)}</span> },
    { key: 'status', header: 'Status', render: (c) => <span>{STATUS_LABEL[c.status] ?? c.status}<Overdue show={c.overdue} /></span> },
    { key: 'open', header: '', align: 'right', render: (c) => <button type="button" className="btn-link" onClick={() => open(c)} disabled={opening}>Open</button> },
  ];

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <div className="flex flex-wrap items-end gap-3" data-testid="complaint-filters">
        {!ownOffice ? (
          <div><label htmlFor="cf-office" className="label">Office</label>
            <select id="cf-office" className="input" value={filters.officeId} onChange={setFilter('officeId')}>
              <option value="">All offices</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select></div>
        ) : null}
        <div><label htmlFor="cf-status" className="label">Status</label>
          <select id="cf-status" className="input" value={filters.status} onChange={setFilter('status')}>
            {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={filters.overdue} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, overdue: e.target.checked })); }} /> Overdue only</label>
      </div>
      <DataTable columns={columns} data={list.items} keyExtractor={(c) => c.complaint_id} loading={list.loading} error={list.error || null}
        rowClassName={(c) => (c.overdue ? 'bg-red-50' : '')} emptyMessage="No complaints." minWidth="52rem"
        pagination={{ page, pageSize, total: list.total, onPage: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }} />
      {!canHandleComplaints(user.role) ? <p className="text-xs text-slate-500">You can read complaints here. Super Admin and Office Heads acknowledge and resolve them.</p> : null}
    </div>
  );
}
