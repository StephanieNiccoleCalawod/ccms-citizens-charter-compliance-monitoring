'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAccessRequest, decideAccessRequest, listAccessGrants, listAccessRequests, revokeAccessGrant } from '../../lib/api/access.js';
import { todayManila } from '../../lib/api/calendar.js';
import { notify } from '../../lib/ui/notify.js';
import { formatDate, formatDateLong } from '../../lib/ui/date-format.js';
import {
  GRANTABLE, GRANT_MAX_DAYS, REASON_MAX, REQUEST_SENT, STATUS_LABEL, STATUS_TONE, accessFailureMessage, canManageAccess, canRequestAccess,
  defaultEndsOn, endsOnBounds, endsOnError, requestError,
} from '../../lib/ui/access.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { FieldError, RequiredMark } from '../forms/Field.js';
import DateHint from '../forms/DateHint.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';
import Tabs, { tabPanelProps } from '../ui/Tabs.js';

const until = (d) => (d ? formatDateLong(d) : '-');

function useList(load) {
  const [state, setState] = useState({ items: [], loading: true, error: '' });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    load().then((data) => setState({ items: data.items ?? [], loading: false, error: '' })).catch((f) => setState({ items: [], loading: false, error: accessFailureMessage(f) }));
  }, [load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the list when the page opens and after each change
  useEffect(() => { reload(); }, [reload]);
  return [state, reload];
}

/** Office Head and Office Staff: ask for one of the four extra permissions, and follow their requests. */
function AskForAccess({ initialKey }) {
  const [permissionKey, setPermissionKey] = useState(GRANTABLE.some((g) => g.key === initialKey) ? initialKey : '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const loadMine = useCallback(() => listAccessRequests(), []);
  const [mine, reloadMine] = useList(loadMine);

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const found = requestError({ permissionKey, reason });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await createAccessRequest({ permissionKey, reason: reason.trim() });
      notify.result({ variant: 'success', ...REQUEST_SENT });
      setReason(''); setPermissionKey('');
      reloadMine();
    } catch (failure) {
      notify.result({ variant: 'error', title: 'The request was not sent', message: accessFailureMessage(failure) });
    } finally { setBusy(false); }
  }

  const columns = [
    { key: 'permission', header: 'Access', render: (r) => r.permission_label },
    { key: 'status', header: 'Answer', render: (r) => <StatusBadge variant={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge> },
    { key: 'until', header: 'Works until', render: (r) => (r.status === 'GRANTED' ? until(r.ends_on) : '-') },
    { key: 'asked', header: 'Asked on', render: (r) => formatDate(String(r.requested_at).slice(0, 10)) },
  ];
  return (
    <div className="space-y-6">
      <form onSubmit={send} className="card space-y-4 p-5" aria-label="Ask for access" data-testid="access-form" noValidate>
        <div>
          <h2 className="title-card">Ask for access</h2>
          <p className="mt-1 text-sm text-slate-600">Ask the Super Admin for one extra permission. It works only for a limited time, in your own office.</p>
        </div>
        <div>
          <label htmlFor="acc-key" className="label">What do you need?<RequiredMark /></label>
          <select id="acc-key" className="input select-chevron" value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)} aria-invalid={Boolean(errors.permissionKey)} aria-describedby={errors.permissionKey ? 'acc-key-error' : undefined}>
            <option value="">Choose one</option>
            {GRANTABLE.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          {permissionKey ? <p className="mt-1 text-xs text-slate-500">{GRANTABLE.find((g) => g.key === permissionKey)?.description}</p> : null}
          <FieldError id="acc-key-error">{errors.permissionKey}</FieldError>
        </div>
        <div>
          <label htmlFor="acc-reason" className="label">Why do you need it?<RequiredMark /></label>
          <textarea id="acc-reason" className="input" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'acc-reason-error' : undefined} />
          <FieldError id="acc-reason-error">{errors.reason}</FieldError>
        </div>
        <Button type="submit" loading={busy} loadingLabel="Sending…" data-testid="access-send">Send request</Button>
      </form>
      <section aria-labelledby="my-requests">
        <h2 id="my-requests" className="title-card mb-2">My requests</h2>
        <DataTable label="My access requests" columns={columns} data={mine.items} keyExtractor={(r) => r.request_id} loading={mine.loading} error={mine.error || null} emptyMessage="You have not asked for any access yet." minWidth="36rem" />
      </section>
    </div>
  );
}

/** Super Admin: decide the waiting requests, and see (and remove) the access that works now. */
function ManageAccess() {
  const [tab, setTab] = useState('requests');
  const today = useMemo(() => todayManila(), []);
  const loadRequests = useCallback(() => listAccessRequests(), []);
  const [requests, reloadRequests] = useList(loadRequests);
  const loadGrants = useCallback(() => listAccessGrants(), []);
  const [grants, reloadGrants] = useList(loadGrants);
  const [granting, setGranting] = useState(null); // the request being approved
  const [endsOn, setEndsOn] = useState('');
  const [endsError, setEndsError] = useState('');
  const [denying, setDenying] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(task, done) {
    if (busy) return;
    setBusy(true); setError('');
    try { await task(); done(); reloadRequests(); reloadGrants(); } catch (failure) { setError(accessFailureMessage(failure)); } finally { setBusy(false); setGranting(null); setDenying(null); setRevoking(null); }
  }
  const openGrant = (r) => { setEndsOn(defaultEndsOn(today)); setEndsError(''); setGranting(r); };
  function confirmGrant() {
    const problem = endsOnError(endsOn, today);
    setEndsError(problem);
    if (problem) return;
    act(() => decideAccessRequest(granting.request_id, { decision: 'GRANT', endsOn }), () => notify.result({ variant: 'success', title: 'Access approved', message: `${granting.account_name} can use “${granting.permission_label}” until ${formatDateLong(endsOn)}.` }));
  }
  const bounds = endsOnBounds(today);

  const requestColumns = [
    { key: 'who', header: 'Person', render: (r) => r.account_name ?? '-' },
    { key: 'what', header: 'Access', render: (r) => r.permission_label },
    { key: 'why', header: 'Why', render: (r) => r.reason },
    { key: 'asked', header: 'Asked on', render: (r) => formatDate(String(r.requested_at).slice(0, 10)) },
    { key: 'status', header: 'Answer', render: (r) => <StatusBadge variant={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge> },
    { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', render: (r) => (r.status === 'PENDING' ? (
      <span className="inline-flex gap-2">
        <button type="button" className="row-action" onClick={() => openGrant(r)} data-testid="access-grant">Grant</button>
        <button type="button" className="row-action" onClick={() => setDenying(r)} data-testid="access-deny">Deny</button>
      </span>) : null) },
  ];
  const grantColumns = [
    { key: 'who', header: 'Person', render: (g) => g.account_name },
    { key: 'what', header: 'Access', render: (g) => g.permission_label },
    { key: 'why', header: 'Why', render: (g) => g.reason },
    { key: 'until', header: 'Works until', render: (g) => <span>{until(g.ends_on)}{g.ends_soon ? <StatusBadge variant="warning" className="ml-2">Ends soon</StatusBadge> : null}</span> },
    { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', render: (g) => <button type="button" className="row-action" onClick={() => setRevoking(g)} data-testid="access-revoke">Remove</button> },
  ];
  const pending = requests.items.filter((r) => r.status === 'PENDING').length;
  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <Tabs label="Access sections" idPrefix="access" value={tab} onChange={setTab} tabs={[{ id: 'requests', label: pending ? `Access requests (${pending})` : 'Access requests' }, { id: 'active', label: 'Active access' }]} />
      <div {...tabPanelProps('access', tab)} className="focus:outline-none">
        {tab === 'requests'
          ? <DataTable label="Access requests" columns={requestColumns} data={requests.items} keyExtractor={(r) => r.request_id} loading={requests.loading} error={requests.error || null} emptyMessage="No one has asked for access yet." minWidth="52rem" />
          : <DataTable label="Active access" columns={grantColumns} data={grants.items} keyExtractor={(g) => g.grant_id} loading={grants.loading} error={grants.error || null} emptyMessage="No one has extra access right now." minWidth="44rem" />}
      </div>
      <Modal open={granting !== null} title="Grant access" onClose={() => !busy && setGranting(null)} showClose
        footer={<><Button variant="secondary" onClick={() => setGranting(null)} disabled={busy}>Cancel</Button><Button onClick={confirmGrant} loading={busy} loadingLabel="Saving…" data-testid="access-grant-confirm">Grant access</Button></>}>
        {granting ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{granting.account_name} asked for “{granting.permission_label}”: {granting.reason}</p>
            <div>
              <label htmlFor="acc-ends" className="label">Works until (last day)<RequiredMark /></label>
              <input id="acc-ends" type="date" className="input" value={endsOn} min={bounds.min} max={bounds.max} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={Boolean(endsError)} aria-describedby={endsError ? 'acc-ends-error acc-ends-hint' : 'acc-ends-hint'} />
              <DateHint id="acc-ends-hint" />
              <p className="mt-1 text-xs text-slate-500">It is 30 days from today unless you change it. The longest is {GRANT_MAX_DAYS} days.</p>
              <FieldError id="acc-ends-error">{endsError}</FieldError>
            </div>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog open={denying !== null} title="Deny this request?" confirmLabel="Deny" busy={busy} busyLabel="Saving…" onCancel={() => setDenying(null)}
        message={denying ? `${denying.account_name} will be told that the request for “${denying.permission_label}” was not approved.` : ''}
        onConfirm={() => act(() => decideAccessRequest(denying.request_id, { decision: 'DENY' }), () => notify.result({ variant: 'success', title: 'Request not approved', message: 'The person will see this in their notifications.' }))} />
      <ConfirmDialog open={revoking !== null} title="Remove this access?" confirmLabel="Remove access" busy={busy} busyLabel="Removing…" onCancel={() => setRevoking(null)}
        message={revoking ? `${revoking.account_name} will no longer be able to use “${revoking.permission_label}”. It stops within about 10 seconds.` : ''}
        onConfirm={() => act(() => revokeAccessGrant(revoking.grant_id), () => notify.result({ variant: 'success', title: 'Access removed', message: 'The person has been told.' }))} />
    </div>
  );
}

export default function AccessPage({ user, initialKey = '' }) {
  if (canManageAccess(user.role)) return <ManageAccess />;
  if (canRequestAccess(user.role)) return <AskForAccess initialKey={initialKey} />;
  return <p className="text-sm text-slate-500">There is nothing to request for your role.</p>;
}
