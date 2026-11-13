'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ConfirmDialog from '../../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../../components/ui/TableShell.js';
import {
  dismissClerkAccessRequest,
  linkAccountToClerk,
  listActiveAccounts,
  listClerkAccessRequests,
  listClerkLinks,
  unlinkAccountFromClerk,
} from '../../../lib/api/clerk-access.js';
import { currentUser } from '../../../lib/auth/session.js';
import { accountLabel, bindableAccounts } from '../../../lib/ui/clerk-access.js';

const when = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Clerk sign-in access (Landas 1, Shared Clerk Access Playbook R3). People who signed in with Clerk wait here until the Super
// Admin binds each one to a CCMS account. The email is only a hint: approval binds the exact Clerk user, and roles and offices
// stay on the CCMS account.
function ClerkAccess() {
  const [requests, setRequests] = useState(null);
  const [links, setLinks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [choice, setChoice] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const me = currentUser();

  // State is only set in the promise callbacks, after the requests answer.
  const load = useCallback(
    () =>
      Promise.all([listClerkAccessRequests(), listClerkLinks(), listActiveAccounts()]).then(
        ([pending, linked, active]) => {
          setRequests(pending.items ?? []);
          setLinks(linked.items ?? []);
          setAccounts(active);
        },
        (err) => {
          setError(err.message);
          setRequests((current) => current ?? []);
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
    load();
  }

  const linkedIds = useMemo(() => links.map((l) => l.account_id), [links]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);

  async function approve(request) {
    const accountId = choice[request.clerk_user_id] ?? request.suggested_account?.account_id;
    if (!accountId) {
      setError('Choose the CCMS account for this person first.');
      return;
    }
    setBusy(request.clerk_user_id);
    setError(null);
    try {
      await linkAccountToClerk(accountId, request.clerk_user_id);
      setNotice(`${accountLabel(byId.get(accountId))} can now sign in with Clerk.`);
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
    try {
      if (action.type === 'dismiss') await dismissClerkAccessRequest(action.request.clerk_user_id);
      if (action.type === 'unlink') {
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

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {notice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="title-section">Waiting for approval</h2>
          <button type="button" className="btn-secondary" onClick={refresh}>
            Refresh
          </button>
        </div>
        <p className="text-sm text-slate-600">
          People who signed in with their PUP account but have no CCMS access yet. Choose the CCMS account that belongs to each person. The email is a hint only: check it is the right person before you approve.
        </p>
        {requests === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody is waiting.</p>
        ) : (
          <TableShell>
            <Table
              minWidth="44rem"
              label="People waiting for approval"
              head={
                <tr>
                  <Th>Signed in as</Th>
                  <Th>Last sign-in</Th>
                  <Th>CCMS account</Th>
                  <Th align="right">Actions</Th>
                </tr>
              }
            >
                {requests.map((request) => {
                  const options = bindableAccounts(accounts, linkedIds, request.suggested_account?.account_id);
                  const selected = choice[request.clerk_user_id] ?? request.suggested_account?.account_id ?? '';
                  return (
                    <tr key={request.clerk_user_id} className="tr-row">
                      <td className="td">
                        <div className="font-medium text-slate-800">{request.email ?? 'No email shared'}</div>
                        <div className="text-xs text-slate-500">{request.clerk_user_id}</div>
                      </td>
                      <td className="td">{when(request.last_seen_at)}</td>
                      <td className="td">
                        <label className="sr-only" htmlFor={`account-${request.clerk_user_id}`}>
                          CCMS account for {request.email ?? request.clerk_user_id}
                        </label>
                        <select
                          id={`account-${request.clerk_user_id}`}
                          className="input"
                          value={selected}
                          onChange={(e) => setChoice((c) => ({ ...c, [request.clerk_user_id]: e.target.value }))}
                        >
                          <option value="">Choose an account…</option>
                          {options.map((account) => (
                            <option key={account.account_id} value={account.account_id}>
                              {accountLabel(account)}
                              {account.account_id === request.suggested_account?.account_id ? ' — same email' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" className="btn-primary" disabled={busy !== null || !selected} onClick={() => approve(request)}>
                            {busy === request.clerk_user_id ? 'Approving…' : 'Approve'}
                          </button>
                          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setConfirm({ type: 'dismiss', request })}>
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </Table>
          </TableShell>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="title-section">Can sign in with Clerk</h2>
        {links.length === 0 ? (
          <p className="text-sm text-slate-500">No account is linked yet.</p>
        ) : (
          <TableShell>
            <Table
              minWidth="32rem"
              label="Accounts that can sign in with Clerk"
              head={
                <tr>
                  <Th>CCMS account</Th>
                  <Th>Approved</Th>
                  <Th align="right">Actions</Th>
                </tr>
              }
            >
                {links.map((link) => {
                  const own = link.account_id === me?.id;
                  return (
                    <tr key={link.account_id} className="tr-row">
                      <td className="td">{accountLabel(byId.get(link.account_id)) || 'Inactive account'}</td>
                      <td className="td">{when(link.linked_at)}</td>
                      <td className="td text-right">
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={busy !== null || own}
                          title={own ? 'You cannot remove your own Clerk sign-in.' : undefined}
                          onClick={() => setConfirm({ type: 'unlink', link })}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </Table>
          </TableShell>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.type === 'unlink' ? 'Remove Clerk sign-in?' : 'Dismiss this sign-in?'}
        message={
          confirm?.type === 'unlink'
            ? 'This person will no longer be able to sign in to CCMS with Clerk. Their PUP account and their access to other systems are not changed.'
            : 'The person gets no access. If they sign in again, they will appear here again.'
        }
        confirmLabel={confirm?.type === 'unlink' ? 'Remove' : 'Dismiss'}
        danger={confirm?.type === 'unlink'}
        busy={busy === 'confirm'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function ClerkAccessPage() {
  return (
    <AppShell title="Clerk sign-in access" subtitle="Approve people who sign in with their PUP account" allowedRoles={[ROLES.SUPER_ADMIN]}>
      <ClerkAccess />
    </AppShell>
  );
}
