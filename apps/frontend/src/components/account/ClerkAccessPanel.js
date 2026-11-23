'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import StatusBanner from '../feedback/StatusBanner.js';
import FilterBar from '../forms/FilterBar.js';
import SearchInput from '../forms/SearchInput.js';
import Button from '../ui/Button.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';
import {
  dismissClerkAccessRequest,
  findClerkLoginForAccount,
  linkAccountFromDirectory,
  linkAccountToClerk,
  listActiveAccounts,
  listClerkAccessRequests,
  listClerkLinks,
  revokeClerkInvitationForAccount,
  sendClerkInvitationForAccount,
  unlinkAccountFromClerk,
} from '../../lib/api/clerk-access.js';
import { currentUser } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import {
  CLERK_ACCESS_STATUSES,
  accountLabel,
  bindableAccounts,
  clerkAccessEmptyMessage,
  clerkAccessRows,
  clerkAccessStatus,
  directoryResultText,
  filterClerkAccessRows,
} from '../../lib/ui/clerk-access.js';
import { plainFailure } from '../../lib/ui/save-feedback.js';

// Clerk sign-in access (Landas 1, Shared Clerk Access Playbook): who may sign in to CCMS with their PUP account. The Accounts
// page's "Clerk Sign-in Access" tab (/settings/clerk-access only redirects here). One table, four states (none of them stored):
//   Pending      signed in with Clerk, no CCMS access yet: choose the CCMS account that belongs to the person, then Approve,
//                or Dismiss. The email is a hint only; approval binds that exact Clerk user (issuer + user ID).
//   Active       can sign in; Remove takes the access away again (never your own).
//   Deactivated  linked, but the CCMS account is deactivated, so it cannot sign in (CCMS-only revocation, R4).
//   Not linked   an active CCMS account without a Clerk login yet. With Flow B on (Identity holds a Clerk Secret Key), the Super
//                Admin can find the person's existing Clerk login by the account's email and link it without waiting for a
//                first sign-in; otherwise the person signs in once and appears as Pending.
// The tab stays mounted while hidden; `active` reloads it each time it is shown, so an account created on the Accounts tab
// appears straight away.
export default function ClerkAccessPanel({ active = true }) {
  const [requests, setRequests] = useState([]);
  const [links, setLinks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [directory, setDirectory] = useState(false);
  const [invitations, setInvitations] = useState(false);
  const [invited, setInvited] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [choice, setChoice] = useState({});
  const [lookups, setLookups] = useState({}); // accountId -> { loading, result, error }
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null); // the record being saved, 'confirm' while a dialog action runs, or null
  const [confirm, setConfirm] = useState(null); // { type: 'dismiss', request } | { type: 'unlink', link } | { type: 'directory', accountId, match } | { type: 'invite', accountId, email } | { type: 'revoke-invitation', accountId }
  const me = currentUser();

  // One load reads every group together. State is only set in the callbacks.
  const load = useCallback(
    () =>
      Promise.all([listClerkAccessRequests(), listClerkLinks(), listActiveAccounts()]).then(
        ([pending, linked, activeAccounts]) => {
          setRequests(pending.items ?? []);
          setLinks(linked.items ?? []);
          setDirectory(linked.directory === true);
          setInvitations(linked.invitations === true);
          setInvited(linked.invited ?? []);
          setAccounts(activeAccounts);
          setLoading(false);
        },
        (err) => {
          setError(plainFailure(err, { fallback: 'The Clerk sign-in requests could not be loaded. Please try again in a moment.' }));
          setLoading(false);
        },
      ),
    [],
  );

  // Load when shown, and again every time the tab is shown again.
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  function refresh() {
    setError(null);
    setNotice(null);
    setLookups({});
    setLoading(true);
    load();
  }

  const byId = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);
  const linkedIds = useMemo(() => links.map((l) => l.account_id), [links]);
  const rows = useMemo(() => clerkAccessRows(requests, links, accounts, invited), [requests, links, accounts, invited]);
  const visible = useMemo(() => filterClerkAccessRows(rows, filters), [rows, filters]);
  const selectedFor = (request) => choice[request.clerk_user_id] ?? request.suggested_account?.account_id ?? '';
  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const nameOf = (accountId) => accountLabel(byId.get(accountId)) || rows.find((r) => r.accountId === accountId)?.primary || 'The account';

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
      setNotice(`${nameOf(accountId)} can now sign in with Clerk.`);
      await load();
    } catch (err) {
      setError(plainFailure(err, { fallback: 'The account was not linked. Nothing was changed. Please try again.', writes: true }));
    } finally {
      setBusy(null);
    }
  }

  async function findInClerk(accountId) {
    setLookups((l) => ({ ...l, [accountId]: { loading: true } }));
    setError(null);
    try {
      const result = await findClerkLoginForAccount(accountId);
      setLookups((l) => ({ ...l, [accountId]: { result } }));
    } catch (err) {
      setLookups((l) => ({ ...l, [accountId]: { error: err.message } }));
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
      } else if (action.type === 'directory') {
        await linkAccountFromDirectory(action.accountId, action.match.clerk_user_id);
        setNotice(`${nameOf(action.accountId)} can now sign in with Clerk.`);
        setLookups((l) => ({ ...l, [action.accountId]: undefined }));
      } else if (action.type === 'invite') {
        await sendClerkInvitationForAccount(action.accountId);
        setNotice(`An invitation was sent to ${action.email} for ${nameOf(action.accountId)}.`);
        setLookups((l) => ({ ...l, [action.accountId]: undefined }));
      } else if (action.type === 'revoke-invitation') {
        await revokeClerkInvitationForAccount(action.accountId);
        setNotice(`The invitation for ${nameOf(action.accountId)} was revoked.`);
      } else {
        await unlinkAccountFromClerk(action.link.account_id);
        setNotice(`${nameOf(action.link.account_id)} can no longer sign in with Clerk.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(plainFailure(err, { fallback: 'That change was not made. Nothing was changed. Please try again.', writes: true }));
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

  function linkedActions(row) {
    const own = row.link.account_id === me?.id;
    return (
      <div className="flex justify-end">
        <Button
          variant="danger"
          size="sm"
          disabled={busy !== null || own}
          title={own ? 'You cannot remove your own Clerk sign-in.' : undefined}
          onClick={() => setConfirm({ type: 'unlink', link: row.link })}
        >
          Remove
        </Button>
      </div>
    );
  }

  function notLinkedActions(row) {
    if (row.invited) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-600">Invitation sent</span>
          {invitations ? (
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setConfirm({ type: 'revoke-invitation', accountId: row.accountId })}>
              Revoke invitation
            </Button>
          ) : null}
        </div>
      );
    }
    if (!directory && !invitations) return <p className="text-right text-xs text-slate-500">Links after their first sign-in</p>;
    const lookup = lookups[row.accountId];
    const open = (lookup?.result?.matches ?? []).filter((m) => !m.already_linked);
    const canInvite = invitations && (!directory || !lookup?.result || (lookup.result.matches ?? []).length === 0);
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {directory && !lookup?.result ? (
            <Button variant="secondary" size="sm" disabled={busy !== null} loading={lookup?.loading} loadingLabel="Finding…" onClick={() => findInClerk(row.accountId)}>
              Find in Clerk
            </Button>
          ) : null}
          {canInvite ? (
            <Button size="sm" disabled={busy !== null || !row.account?.email} onClick={() => setConfirm({ type: 'invite', accountId: row.accountId, email: row.account?.email })}>
              Send invitation
            </Button>
          ) : null}
        </div>
        {lookup?.error ? <p className="text-right text-xs text-red-700">{lookup.error}</p> : null}
        {lookup?.result ? <p className="max-w-xs text-right text-xs text-slate-600">{directoryResultText(lookup.result, { invitations })}</p> : null}
        {open.map((match) => (
          <div key={match.clerk_user_id} className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-slate-700">
              {match.name ? `${match.name} · ` : ''}
              {match.email}
            </span>
            <Button size="sm" disabled={busy !== null || match.banned || match.locked} onClick={() => setConfirm({ type: 'directory', accountId: row.accountId, match })}>
              Link
            </Button>
          </div>
        ))}
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
          <p className="text-slate-900">{row.date ? formatDateTime(row.date) || '—' : '—'}</p>
          <p className="text-xs text-slate-500">{row.dateLabel}</p>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const status = clerkAccessStatus(row.status);
        return <StatusBadge variant={status.tone}>{status.label}</StatusBadge>;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (row) => (row.status === 'pending' ? pendingActions(row.request) : row.status === 'not_linked' ? notLinkedActions(row) : linkedActions(row)),
    },
  ];

  const dialog =
    confirm?.type === 'unlink'
      ? {
          title: 'Remove Clerk sign-in?',
          message: 'This person will no longer be able to sign in to CCMS with Clerk. Their PUP account and their access to other systems are not changed.',
          label: 'Remove',
          danger: true,
        }
      : confirm?.type === 'directory'
        ? {
            title: 'Link this Clerk login?',
            message: `${nameOf(confirm.accountId)} will sign in to CCMS with the Clerk login ${confirm.match.email}${confirm.match.name ? ` (${confirm.match.name})` : ''}. Their role and office stay as they are in CCMS.`,
            label: 'Link',
            danger: false,
          }
        : confirm?.type === 'invite'
          ? {
              title: 'Send Clerk invitation?',
              message: `Clerk will email an invitation to ${confirm.email} for ${nameOf(confirm.accountId)}. Check the email address carefully before sending. When they accept and sign in, this account will be linked automatically.`,
              label: 'Send invitation',
              danger: false,
            }
          : confirm?.type === 'revoke-invitation'
            ? {
                title: 'Revoke this invitation?',
                message: `The pending Clerk invitation for ${nameOf(confirm.accountId)} will be cancelled. You can send a new one afterwards.`,
                label: 'Revoke invitation',
                danger: true,
              }
            : {
            title: 'Dismiss this sign-in?',
            message: 'The person gets no access. If they sign in again, they will appear here again.',
            label: 'Dismiss',
            danger: false,
          };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Clerk Sign-in Access</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage users who sign in through their PUP account and control their access to CCMS. For a pending user, choose the CCMS
          account that belongs to them before you approve: the email is a hint only, so check it is the right person. Roles and
          offices are set on the account in the Accounts tab.
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <StatusBanner variant="success" message={notice} onDismiss={() => setNotice(null)} dismissAriaLabel="Dismiss message" />

      <FilterBar
        label="Clerk sign-in access filters"
        dirty={Boolean(filters.q.trim() || filters.status)}
        onClear={() => setFilters({ q: '', status: '' })}
        actions={
          <Button variant="secondary" className="w-full sm:w-auto" onClick={refresh} disabled={busy !== null || loading}>
            Refresh
          </Button>
        }
      >
        <div className="w-full sm:w-72">
          <label className="label" htmlFor="clerk-access-search">Search</label>
          <SearchInput id="clerk-access-search" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <label className="label" htmlFor="clerk-access-status">Status</label>
          <select id="clerk-access-status" className="input select-chevron" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All</option>
            {CLERK_ACCESS_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </FilterBar>

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
        title={dialog.title}
        message={dialog.message}
        confirmLabel={dialog.label}
        danger={dialog.danger}
        busy={busy === 'confirm'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
