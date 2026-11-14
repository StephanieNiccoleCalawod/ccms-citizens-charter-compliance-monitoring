'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import StatusBanner from '../feedback/StatusBanner.js';
import SearchInput from '../forms/SearchInput.js';
import Button from '../ui/Button.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';
import {
  dismissClerkAccessRequest,
  linkAccountToClerk,
  listActiveAccounts,
  listClerkAccessRequests,
  listClerkLinks,
  unlinkAccountFromClerk,
} from '../../lib/api/clerk-access.js';
import { currentUser } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { accountLabel, bindableAccounts, clerkAccessEmptyMessage, clerkAccessRows, filterClerkAccessRows } from '../../lib/ui/clerk-access.js';

// Clerk sign-in access (Landas 1, Shared Clerk Access Playbook R3): who may sign in to CCMS with their PUP account. The Accounts
// page's "Clerk Sign-in Access" tab (/settings/clerk-access only redirects here). One table holds both kinds of record:
//   Pending   signed in with Clerk, no CCMS access yet. The Super Admin chooses the CCMS account that belongs to the person,
//             then approves (or dismisses the sign-in). The email is a hint only: approval binds that exact Clerk user (issuer +
//             user ID), and the role and office stay on the CCMS account.
//   Approved  may sign in with Clerk; Remove takes the access away again (never your own).
export default function ClerkAccessPanel() {
  const [requests, setRequests] = useState([]);
  const [links, setLinks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [choice, setChoice] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null); // the clerk_user_id being approved, 'confirm' while a dialog action runs, or null
  const [confirm, setConfirm] = useState(null); // { type: 'dismiss', request } | { type: 'unlink', link }
  const me = currentUser();

  // One refresh loads both groups (and the accounts for names and the choice) together. State is only set in the callbacks.
  const load = useCallback(
    () =>
      Promise.all([listClerkAccessRequests(), listClerkLinks(), listActiveAccounts()]).then(
        ([pending, linked, active]) => {
          setRequests(pending.items ?? []);
          setLinks(linked.items ?? []);
          setAccounts(active);
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        },
      ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    setError(null);
    setNotice(null);
    setLoading(true);
    load();
  }

  const byId = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);
  const linkedIds = useMemo(() => links.map((l) => l.account_id), [links]);
  const rows = useMemo(() => clerkAccessRows(requests, links, byId), [requests, links, byId]);
  const visible = useMemo(() => filterClerkAccessRows(rows, filters), [rows, filters]);
  const selectedFor = (request) => choice[request.clerk_user_id] ?? request.suggested_account?.account_id ?? '';
  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));

  async function approve(request) {
    const accountId = selectedFor(request);
    if (!accountId) {
      setError('Choose the CCMS account for this person first.');
      return;
    }
    setBusy(request.clerk_user_id);
    setError(null);
    setNotice(null);
    try {
      await linkAccountToClerk(accountId, request.clerk_user_id);
      setNotice(`${accountLabel(byId.get(accountId)) || 'The account'} can now sign in with Clerk.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function runConfirmed() {
    const action = confirm;
    setBusy('confirm');
    setError(null);
    setNotice(null);
    try {
      if (action.type === 'dismiss') {
        await dismissClerkAccessRequest(action.request.clerk_user_id);
        setNotice('The sign-in was dismissed. No access was given.');
      } else {
        await unlinkAccountFromClerk(action.link.account_id);
        setNotice(`${accountLabel(byId.get(action.link.account_id)) || 'The account'} can no longer sign in with Clerk.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  }

  function pendingActions(request) {
    const options = bindableAccounts(accounts, linkedIds, request.suggested_account?.account_id);
    const id = `clerk-account-${request.clerk_user_id}`;
    const selected = selectedFor(request);
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="sr-only" htmlFor={id}>
          CCMS account for {request.email ?? request.clerk_user_id}
        </label>
        <select
          id={id}
          className="input select-chevron w-full sm:w-56"
          value={selected}
          disabled={busy !== null}
          onChange={(e) => setChoice((c) => ({ ...c, [request.clerk_user_id]: e.target.value }))}
        >
          <option value="">Choose a CCMS account…</option>
          {options.map((account) => (
            <option key={account.account_id} value={account.account_id}>
              {accountLabel(account)}
              {account.account_id === request.suggested_account?.account_id ? ' — same email' : ''}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={(busy !== null && busy !== request.clerk_user_id) || !selected}
          loading={busy === request.clerk_user_id}
          loadingLabel="Approving…"
          onClick={() => approve(request)}
        >
          Approve
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setConfirm({ type: 'dismiss', request })}>
          Dismiss
        </Button>
      </div>
    );
  }

  function approvedActions(link) {
    const own = link.account_id === me?.id;
    return (
      <div className="flex justify-end">
        <Button
          variant="danger"
          size="sm"
          disabled={busy !== null || own}
          title={own ? 'You cannot remove your own Clerk sign-in.' : undefined}
          onClick={() => setConfirm({ type: 'unlink', link })}
        >
          Remove
        </Button>
      </div>
    );
  }

  const columns = [
    {
      key: 'account',
      header: 'Signed In As / CCMS Account',
      render: (row) => (
        <>
          <p className="font-semibold text-slate-900">{row.primary}</p>
          {row.secondary ? <p className="text-xs text-slate-500">{row.secondary}</p> : null}
        </>
      ),
    },
    {
      key: 'date',
      header: 'Last Sign-in / Approved',
      render: (row) => (
        <>
          <p className="text-slate-900">{formatDateTime(row.date) || '—'}</p>
          <p className="text-xs text-slate-500">{row.dateLabel}</p>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge variant={row.status === 'pending' ? 'warning' : 'success'}>{row.status === 'pending' ? 'Pending' : 'Approved'}</StatusBadge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (row) => (row.status === 'pending' ? pendingActions(row.request) : approvedActions(row.link)),
    },
  ];

  const unlinking = confirm?.type === 'unlink';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Clerk Sign-in Access</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage users who sign in through their PUP account and control their access to CCMS. For a pending user, choose the CCMS
          account that belongs to them before you approve: the email is a hint only, so check it is the right person.
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <StatusBanner variant="success" message={notice} onDismiss={() => setNotice(null)} dismissAriaLabel="Dismiss message" />

      <section aria-label="Clerk sign-in access filters" className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div className="w-full sm:w-72">
            <label className="label" htmlFor="clerk-access-search">Search</label>
            <SearchInput id="clerk-access-search" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          </div>
          <div className="w-full sm:w-40">
            <label className="label" htmlFor="clerk-access-status">Status</label>
            <select id="clerk-access-status" className="input select-chevron" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={refresh} disabled={busy !== null || loading}>
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <DataTable
        label="Clerk sign-in access"
        columns={columns}
        data={visible}
        keyExtractor={(row) => row.key}
        loading={loading}
        emptyMessage={clerkAccessEmptyMessage(filters)}
        minWidth="56rem"
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={unlinking ? 'Remove Clerk sign-in?' : 'Dismiss this sign-in?'}
        message={
          unlinking
            ? 'This person will no longer be able to sign in to CCMS with Clerk. Their PUP account and their access to other systems are not changed.'
            : 'The person gets no access. If they sign in again, they will appear here again.'
        }
        confirmLabel={unlinking ? 'Remove' : 'Dismiss'}
        danger={unlinking}
        busy={busy === 'confirm'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
