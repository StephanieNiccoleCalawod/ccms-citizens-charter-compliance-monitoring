'use client';

import { useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import { RequiredMark } from '../forms/Field.js';

const SCOPE_ALL = 'all';
const SCOPE_SPECIFIC = 'specific';

/**
 * The one confirmation modal for all four staff permission switches (STAFF_HOLD_RESUME, STAFF_BACKDATE,
 * STAFF_VIEW_COMPLAINTS, STAFF_VIEW_REPORTS), reused for whichever one the admin just toggled in the matrix (see
 * settings/roles/page.js, which keys this component by the pending toggle so a fresh open always starts from the
 * one choice that can be confirmed - All Offices - instead of carrying over a previous "Specific Office" pick).
 * Shows the permission, the requested action, the affected role(s) and an office scope choice before anything is
 * saved.
 *
 * Only "All Offices" can actually be confirmed today: the four switches are each one global flag with no office_id
 * in their schema (identity-service's permission_switches table - switch_key alone is the primary key), and every
 * service that enforces them checks that same single global value. "Specific Office" is still fully built here,
 * with the real office list (no mock data), so the control is ready and the limitation is explained rather than
 * silently applying to every office anyway; Confirm Change stays disabled while it is chosen.
 */
export default function PermissionConfirmModal({ open, pending, switchInfo, affectedRoles, offices, busy, onConfirm, onCancel }) {
  const [scope, setScope] = useState(SCOPE_ALL);
  const [officeId, setOfficeId] = useState('');

  if (!pending) return null;

  const officeName = offices.find((o) => o.office_id === officeId)?.office_name ?? '';
  const affectedLabel = affectedRoles.map((r) => r.label).join(', ') || pending.role?.label || '';
  const action = pending.nextEnabled ? 'Enable' : 'Disable';

  return (
    <ConfirmDialog
      open={open}
      title={`${action} permission?`}
      confirmLabel="Confirm Change"
      busy={busy}
      busyLabel="Saving…"
      disabled={scope !== SCOPE_ALL}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <dl className="space-y-1.5 text-sm" data-testid="permission-confirm-summary">
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Permission</dt><dd className="text-right font-semibold text-ink">{pending.row.label}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Requested action</dt><dd className="text-right font-semibold text-ink">{action}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Affected role(s)</dt><dd className="text-right font-semibold text-ink">{affectedLabel}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Office scope</dt><dd className="text-right font-semibold text-ink">{scope === SCOPE_ALL ? 'All Offices' : 'Specific Office'}</dd></div>
        {scope === SCOPE_SPECIFIC && officeId ? (
          <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Selected office</dt><dd className="text-right font-semibold text-ink">{officeName}</dd></div>
        ) : null}
      </dl>
      {switchInfo?.description ? <p className="mt-3 text-sm text-ink-muted">{switchInfo.description}</p> : null}

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <div>
          <label htmlFor="permission-office-scope" className="label">Office scope<RequiredMark /></label>
          <select
            id="permission-office-scope"
            className="input select-chevron"
            value={scope}
            disabled={busy}
            onChange={(event) => { setScope(event.target.value); setOfficeId(''); }}
          >
            <option value={SCOPE_ALL}>All Offices</option>
            <option value={SCOPE_SPECIFIC}>Specific Office</option>
          </select>
        </div>

        {scope === SCOPE_SPECIFIC ? (
          <div>
            <label htmlFor="permission-office-select" className="label">Select office<RequiredMark /></label>
            <select
              id="permission-office-select"
              className="input select-chevron"
              value={officeId}
              disabled={busy}
              onChange={(event) => setOfficeId(event.target.value)}
            >
              <option value="">Choose an office</option>
              {offices.map((office) => <option key={office.office_id} value={office.office_id}>{office.office_name}</option>)}
            </select>
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" data-testid="permission-office-scope-unavailable">
              Office-specific permissions are not available yet - every one of these four switches applies to all offices. Choose All Offices to continue.
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">This change applies to every office.</p>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        This change persists immediately in the backend, is enforced on the next API request, and is recorded in the audit log.
      </p>
    </ConfirmDialog>
  );
}
