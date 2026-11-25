'use client';

import { useEffect, useState } from 'react';
import Switch from '../../components/ui/Switch.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { BACKDATE_OFFICE_MESSAGES } from '../../lib/ui/backdate.js';
import { notify } from '../../lib/ui/notify.js';

/**
 * Settings, Offices (Super Admin): which offices may record a past transaction. Off by default. A change is saved the moment the
 * switch is used, and the on-screen state follows only what the server confirmed. The server audits every change.
 */
export default function OfficeBackdate() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(OFFICES_API)
      .then((data) => !cancelled && setState({ loading: false, items: data?.items ?? [], error: null }))
      .catch(() => !cancelled && setState({ loading: false, items: [], error: 'The offices could not be loaded. Reload the page to try again.' }));
    return () => { cancelled = true; };
  }, []);

  async function change(office, on) {
    if (busy) return;
    setBusy(office.office_id);
    try {
      const saved = await apiFetch(`${OFFICES_API}/${encodeURIComponent(office.office_id)}`, { method: 'PATCH', body: { allow_backdated_transactions: on } });
      const confirmed = typeof saved?.allow_backdated_transactions === 'boolean' ? saved.allow_backdated_transactions : on;
      setState((s) => ({ ...s, items: s.items.map((o) => (o.office_id === office.office_id ? { ...o, allow_backdated_transactions: confirmed } : o)) }));
      notify.success(BACKDATE_OFFICE_MESSAGES.saved(office.office_name, confirmed));
    } catch (err) {
      notify.error(err?.status === 403 ? BACKDATE_OFFICE_MESSAGES.denied : BACKDATE_OFFICE_MESSAGES.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="office-backdate-heading" data-testid="office-backdate">
      <div>
        <h2 id="office-backdate-heading" className="text-base font-semibold text-slate-900">Record a past transaction</h2>
        <p className="mt-0.5 text-sm text-slate-500">Choose the offices whose staff may record a transaction that was already done. It is off for every office until you turn it on. A Super Admin can always do it. Each change is recorded in the audit log.</p>
      </div>
      {state.loading ? <p className="text-sm text-slate-500">Loading offices…</p> : null}
      {state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}
      <ul className="divide-y divide-line">
        {state.items.map((office) => (
          <li key={office.office_id} className="py-3">
            <Switch
              label={office.office_name}
              checked={office.allow_backdated_transactions === true}
              disabled={busy !== null}
              onChange={(on) => change(office, on)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
