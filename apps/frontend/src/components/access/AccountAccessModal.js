'use client';

import { useState } from 'react';
import { revokeAccessGrant } from '../../lib/api/access.js';
import { accessFailureMessage, permissionLabel } from '../../lib/ui/access.js';
import { formatDateLong } from '../../lib/ui/date-format.js';
import { notify } from '../../lib/ui/notify.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import StatusBadge from '../ui/StatusBadge.js';

/** The extra access one account holds, with Remove, opened from that account's row on the Accounts page (S8-52). The same removal as on the Access page. */
export default function AccountAccessModal({ account, grants, onClose, onChanged }) {
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy || !removing) return;
    setBusy(true); setError('');
    try {
      await revokeAccessGrant(removing.grant_id);
      notify.result({ variant: 'success', title: 'Access removed', message: `${account.full_name} no longer has “${permissionLabel(removing.permission_key)}”.` });
      setRemoving(null);
      await onChanged();
    } catch (failure) {
      setError(accessFailureMessage(failure)); setRemoving(null);
    } finally { setBusy(false); }
  }

  return (
    <>
      <Modal open={Boolean(account)} title={`Extra access: ${account?.full_name ?? ''}`} onClose={onClose} showClose widthClass="max-w-xl"
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        {grants.length === 0 ? <p className="text-sm text-slate-600" data-testid="account-access-empty">This person has no extra access.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="account-access-list">
            {grants.map((g) => (
              <li key={g.grant_id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900">{g.permission_label ?? permissionLabel(g.permission_key)}</span>
                  <span className="block text-slate-600">{g.reason}</span>
                  <span className="mt-1 block text-xs text-slate-500">Works until {formatDateLong(g.ends_on)}{g.ends_soon ? <StatusBadge variant="warning" className="ml-2">Ends soon</StatusBadge> : null}</span>
                </span>
                <button type="button" className="row-action shrink-0" onClick={() => setRemoving(g)} data-testid="account-access-remove">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog open={removing !== null} title="Remove this access?" confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)}
        message={removing ? `${account?.full_name} will lose “${permissionLabel(removing.permission_key)}” at once. They can ask for it again.` : ''} />
    </>
  );
}
