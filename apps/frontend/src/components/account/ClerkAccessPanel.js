'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Button from '../ui/Button.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import { listActiveAccounts, listClerkLinks, unlinkAccountFromClerk } from '../../lib/api/clerk-access.js';
import { currentUser } from '../../lib/auth/session.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { accountLabel } from '../../lib/ui/clerk-access.js';

// Clerk sign-in access (Landas 1, Shared Clerk Access Playbook R3): who may sign in to CCMS with their PUP account. Lives as
// the Accounts page's "Clerk Sign-in Access" tab (it used to be its own page at /settings/clerk-access, which now only
// redirects here). Only approved accounts are managed here; binding a new sign-in request to an account is done elsewhere.
export default function ClerkAccessPanel() {
  const [links, setLinks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const me = currentUser();

  // State is only set in the promise callbacks, after the request answers.
  const load = useCallback(
    () =>
      Promise.all([listClerkLinks(), listActiveAccounts()]).then(
        ([linked, active]) => {
          setLinks(linked.items ?? []);
          setAccounts(active);
        },
        (err) => setError(err.message),
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

  const byId = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);

  async function runConfirmed() {
    const { link } = confirm;
    setBusy(true);
    setError(null);
    try {
      await unlinkAccountFromClerk(link.account_id);
      setNotice(`${accountLabel(byId.get(link.account_id)) || 'The account'} can no longer sign in with Clerk.`);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const linkColumns = [
    {
      key: 'account',
      header: 'CCMS Account',
      render: (link) => {
        const account = byId.get(link.account_id);
        if (!account) return <span className="text-slate-500">Inactive account</span>;
        return (
          <>
            <p className="font-semibold text-slate-900">{account.full_name}</p>
            {account.employee_no ? <p className="text-xs text-slate-500">{account.employee_no}</p> : null}
          </>
        );
      },
    },
    { key: 'approved', header: 'Approved', render: (link) => formatDateTime(link.linked_at) || '—' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (link) => {
        const own = link.account_id === me?.id;
        return (
          <Button
            variant="danger"
            size="sm"
            disabled={busy || own}
            title={own ? 'You cannot remove your own Clerk sign-in.' : undefined}
            onClick={() => setConfirm({ link })}
          >
            Remove
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <StatusBanner variant="success" message={notice} onDismiss={() => setNotice(null)} dismissAriaLabel="Dismiss message" />

      <div className="flex justify-end">
        <Button variant="secondary" onClick={refresh}>Refresh</Button>
      </div>

      <Card title="Can Sign In with Clerk" description="Users who are approved to access CCMS through their PUP account.">
        <DataTable
          label="Accounts that can sign in with Clerk"
          columns={linkColumns}
          data={links}
          keyExtractor={(link) => link.account_id}
          emptyMessage="No account is linked yet."
          minWidth="32rem"
        />
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Remove Clerk sign-in?"
        message="This person will no longer be able to sign in to CCMS with Clerk. Their PUP account and their access to other systems are not changed."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
