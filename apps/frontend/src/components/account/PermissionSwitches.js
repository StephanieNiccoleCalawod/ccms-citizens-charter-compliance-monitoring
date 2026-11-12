'use client';

import { useState } from 'react';
import Switch from '../ui/Switch.js';
import SubmitButton from '../ui/SubmitButton.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { switchChanges, switchValues } from '../../lib/ui/account.js';
import { notify } from '../../lib/ui/notify.js';

/**
 * The four staff permission switches. Only these can be changed; each takes effect on the staff member's next request.
 * `view` is what the server last confirmed; the draft is only kept until Save, and Save sends just the switches that changed.
 */
export default function PermissionSwitches({ view, onSaved, save }) {
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

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-label="Staff permission switches">
      {error ? <StatusBanner variant="error" message={error} /> : null}
      {view.switches.map((item) => (
        <div key={item.key}>
          <Switch label={item.label} description={item.description} checked={draft[item.key] === true} disabled={busy} onChange={(value) => setDraft((d) => ({ ...d, [item.key]: value }))} />
          {item.updated_at ? <p className="mt-1 text-xs text-slate-500">Last changed {formatDateTime(item.updated_at)}</p> : <p className="mt-1 text-xs text-slate-500">Never changed (off by default)</p>}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <SubmitButton busy={busy} disabled={!dirty} label="Save changes" />
        {dirty ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDraft(saved)}>
            Discard changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
