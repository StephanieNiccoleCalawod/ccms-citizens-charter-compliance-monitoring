'use client';

import { useState } from 'react';
import { SWITCH_SCOPE_ALL, SWITCH_SCOPE_SPECIFIC, buildSwitchUpdate, switchOfficeIdsOf, switchScopeOf } from '../../lib/ui/account.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import { RequiredMark } from '../forms/Field.js';
import OfficeCheckboxList from '../forms/OfficeCheckboxList.js';

/**
 * The one confirmation modal for all four staff permission switches (STAFF_HOLD_RESUME, STAFF_BACKDATE,
 * STAFF_VIEW_COMPLAINTS, STAFF_VIEW_REPORTS). Supports choosing All Offices or Specific Office(s) via multi-select
 * checkboxes when enabling or updating scope, and safely disables the switch globally when turning off.
 * Keyed by the caller (settings/roles/page.js) so each open initializes cleanly from the saved switch state.
 */
export default function PermissionConfirmModal({ open, pending, switchInfo, affectedRoles, offices = [], busy, onConfirm, onCancel }) {
  const [scope, setScope] = useState(() => switchScopeOf(switchInfo));
  const [officeIds, setOfficeIds] = useState(() => switchOfficeIdsOf(switchInfo));

  if (!pending) return null;

  const isEditingScope = Boolean(pending.nextEnabled && switchInfo?.enabled === true);
  const affectedLabel = affectedRoles.map((r) => r.label).join(', ') || pending.role?.label || '';
  const action = pending.nextEnabled ? (isEditingScope ? 'Update scope' : 'Enable') : 'Disable';
  const title = isEditingScope ? 'Update office scope?' : `${action} permission?`;

  const selectedSet = new Set(officeIds.map((id) => String(id).toLowerCase()));
  const selectedNames = offices
    .filter((o) => selectedSet.has(String(o.office_id).toLowerCase()))
    .map((o) => o.office_name);
  const selectedPreview = selectedNames.length <= 3
    ? selectedNames.join(', ')
    : `${selectedNames.slice(0, 3).join(', ')} +${selectedNames.length - 3} more`;

  const confirmDisabled = pending.nextEnabled && scope === SWITCH_SCOPE_SPECIFIC && officeIds.length === 0;
  const currentWasSpecific = switchScopeOf(switchInfo) === SWITCH_SCOPE_SPECIFIC;

  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel="Confirm Change"
      busy={busy}
      busyLabel="Saving…"
      disabled={confirmDisabled}
      onConfirm={() => onConfirm(buildSwitchUpdate({ nextEnabled: pending.nextEnabled, scope, officeIds, currentSwitch: switchInfo }))}
      onCancel={onCancel}
    >
      <dl className="space-y-1.5 text-sm" data-testid="permission-confirm-summary">
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Permission</dt><dd className="text-right font-semibold text-ink">{pending.row.label}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Requested action</dt><dd className="text-right font-semibold text-ink">{action}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4"><dt className="text-ink-muted">Affected role(s)</dt><dd className="text-right font-semibold text-ink">{affectedLabel}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="text-ink-muted">Office scope</dt>
          <dd className="text-right font-semibold text-ink">
            {pending.nextEnabled ? (scope === SWITCH_SCOPE_ALL ? 'All Offices' : 'Specific Office(s)') : 'All Offices (off)'}
          </dd>
        </div>
        {pending.nextEnabled && scope === SWITCH_SCOPE_SPECIFIC && officeIds.length > 0 ? (
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-ink-muted">Selected offices</dt>
            <dd className="max-w-[16rem] text-right font-semibold text-ink">{selectedPreview || `${officeIds.length} selected`}</dd>
          </div>
        ) : null}
      </dl>
      {switchInfo?.description ? <p className="mt-3 text-sm text-ink-muted">{switchInfo.description}</p> : null}

      {pending.nextEnabled ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <div>
            <label htmlFor="permission-office-scope" className="label">Office scope<RequiredMark /></label>
            <select
              id="permission-office-scope"
              className="input select-chevron"
              value={scope}
              disabled={busy}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value={SWITCH_SCOPE_ALL}>All Offices</option>
              <option value={SWITCH_SCOPE_SPECIFIC}>Specific Office(s)</option>
            </select>
          </div>

          {scope === SWITCH_SCOPE_SPECIFIC ? (
            <div>
              <span className="label block">Select offices<RequiredMark /></span>
              <OfficeCheckboxList
                offices={offices}
                selectedIds={officeIds}
                onChange={setOfficeIds}
                disabled={busy}
                idPrefix={`permission-office-${pending.switchKey}`}
              />
              {officeIds.length === 0 ? (
                <p className="mt-2 text-xs font-medium text-red-700" data-testid="permission-office-required">
                  Select at least one office to confirm.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">This permission applies to Office Staff in every office.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs text-ink-muted">
            Disabling turns this permission off for all offices.
            {currentWasSpecific ? ' To remove individual offices instead, cancel and edit its office scope.' : ''}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        This change persists immediately in the backend, is enforced on the next API request, and is recorded in the audit log.
      </p>
    </ConfirmDialog>
  );
}
