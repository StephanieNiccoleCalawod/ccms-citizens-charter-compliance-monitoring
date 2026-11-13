'use client';

import { useState } from 'react';
import Modal from '../modals/Modal.js';
import Switch from '../ui/Switch.js';
import SubmitButton from '../ui/SubmitButton.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { switchChanges, switchValues } from '../../lib/ui/account.js';
import { notify } from '../../lib/ui/notify.js';

/**
 * The four staff permission switches, as the "Manage Staff Permissions" modal opened from the Roles and permissions page.
 * Only these can be changed; each takes effect on the staff member's next request, with no need to sign in again.
 * `view` is what the server last confirmed; the draft is only kept until Save, and Save sends just the switches that
 * changed. The caller keys this component by something that changes each time it is opened (see settings/roles/page.js),
 * so a cancelled, unsaved draft is never shown again the next time it is opened: a fresh mount starts from `view` again.
 */
export default function PermissionSwitches({ open, onClose, view, onSaved, save }) {
  const [draft, setDraft] = useState(() => switchValues(view.switches));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const saved = switchValues(view.switches);
  const changes = switchChanges(saved, draft);
  const dirty = Object.keys(changes).length > 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const next = await save(changes);
      setDraft(switchValues(next.switches));
      onSaved(next);
      notify.success('Permission switches saved.');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Cancel, the X and Escape all do the same thing: close without saving. Never while a save is in flight, so the
  // person cannot lose track of whether it went through.
  function requestClose() {
    if (busy) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : requestClose}
      title="Staff Permission Settings"
      showClose
      dirty={dirty}
      widthClass="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={requestClose} disabled={busy}>Cancel</button>
          <SubmitButton form="staff-permissions-form" busy={busy} disabled={!dirty} label="Save changes" />
        </>
      }
    >
      <form id="staff-permissions-form" onSubmit={onSubmit} className="space-y-1" aria-label="Staff permission switches">
        <p className="mb-4 text-sm text-slate-600">Manage which actions Office Staff members are allowed to perform within CCMS.</p>
        {error ? <StatusBanner variant="error" message={error} className="mb-4" /> : null}
        <div className="divide-y divide-line">
          {view.switches.map((item) => (
            <div key={item.key} className="py-4 first:pt-0 last:pb-0">
              <Switch label={item.label} description={item.description} checked={draft[item.key] === true} disabled={busy} onChange={(value) => setDraft((d) => ({ ...d, [item.key]: value }))} />
              {item.updated_at ? <p className="mt-1 text-xs text-slate-500">Last changed {formatDateTime(item.updated_at)}</p> : <p className="mt-1 text-xs text-slate-500">Never changed (off by default)</p>}
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
