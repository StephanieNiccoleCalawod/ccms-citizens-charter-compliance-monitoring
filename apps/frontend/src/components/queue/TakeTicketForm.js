'use client';

import { useEffect, useState } from 'react';
import ErrorBanner from '../feedback/ErrorBanner.js';
import PublicHeader from '../layout/PublicHeader.js';
import { listPublicOffices } from '../../lib/api/complaints.js';
import { takeTicket } from '../../lib/api/queue.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { PRIORITY_OPTIONS, describeTakeFailure, laneLabel } from '../../lib/ui/queue.js';

// CC039: a walk-in takes a queue number without signing in and without giving any personal detail. The number comes from the
// server (per office, per Manila day, from 001); the page keeps nothing once it is left.
export default function TakeTicketForm() {
  const [offices, setOffices] = useState({ items: [], loading: true, failed: false });
  const [form, setForm] = useState({ office_id: '', priority_group: '' });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    let active = true;
    listPublicOffices().then((items) => active && setOffices({ items, loading: false, failed: false })).catch(() => active && setOffices({ items: [], loading: false, failed: true }));
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBanner('');
    if (!form.office_id) {
      setErrors({ office_id: 'Choose an office.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setTicket(await takeTicket(form));
    } catch (failure) {
      const { message, fields } = describeTakeFailure(failure);
      setBanner(message);
      setErrors(fields);
    } finally {
      setBusy(false);
    }
  }

  const another = () => {
    setTicket(null);
    setForm({ office_id: '', priority_group: '' });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="mx-auto max-w-xl px-4 py-8">
        {ticket ? (
          <section className="card space-y-3 p-6 text-center" role="status" data-testid="ticket-done">
            <p className="text-sm text-slate-700">Your number{ticket.office_name ? ` at ${ticket.office_name}` : ''} is</p>
            <p className="text-5xl font-bold tracking-wide text-maroon-900" data-testid="ticket-number">{ticket.ticket_no}</p>
            <p className="text-sm text-slate-700">{laneLabel(ticket.lane)} line{ticket.waiting_ahead > 0 ? `, ${ticket.waiting_ahead} ahead of you` : ', you are next'}.</p>
            <p className="text-xs text-slate-500">Issued {formatDateTime(ticket.issued_at) || '-'} (Asia/Manila). Please wait for your number to be called. If you are not at the counter within 3 minutes of the call, your number moves to the end of the line.</p>
            <button type="button" className="btn-secondary" onClick={another}>Done</button>
          </section>
        ) : (
          <form className="card space-y-4 p-6" onSubmit={submit} noValidate data-testid="take-ticket-form">
            <div>
              <h1 className="text-xl font-bold text-maroon-950">Take a queue number</h1>
              <p className="mt-1 text-sm text-slate-600">No account and no personal details are needed.</p>
            </div>
            <ErrorBanner message={banner} onDismiss={() => setBanner('')} />
            {offices.failed ? <ErrorBanner message="The list of offices could not be loaded. Please reload the page." /> : null}
            <div>
              <label htmlFor="q-office" className="label">Office *</label>
              <select id="q-office" className="input" value={form.office_id} onChange={(e) => setForm((f) => ({ ...f, office_id: e.target.value }))} disabled={offices.loading}
                aria-invalid={Boolean(errors.office_id)} aria-describedby={errors.office_id ? 'q-office-error' : undefined}>
                <option value="">{offices.loading ? 'Loading offices…' : 'Choose an office'}</option>
                {offices.items.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
              </select>
              {errors.office_id ? <p id="q-office-error" className="mt-1 text-xs text-red-700">{errors.office_id}</p> : null}
            </div>
            <fieldset>
              <legend className="label">Priority line</legend>
              <p className="mb-2 text-xs text-slate-500">Senior citizens, persons with disability and pregnant women are served first. Choose one only if it applies to you; you may be asked to show proof at the counter.</p>
              <div className="space-y-1">
                {PRIORITY_OPTIONS.map((option) => (
                  <label key={option.value || 'none'} className="flex items-center gap-2 text-sm text-slate-800">
                    <input type="radio" name="priority_group" value={option.value} checked={form.priority_group === option.value} onChange={() => setForm((f) => ({ ...f, priority_group: option.value }))} />
                    {option.label}
                  </label>
                ))}
              </div>
              {errors.priority_group ? <p className="mt-1 text-xs text-red-700">{errors.priority_group}</p> : null}
            </fieldset>
            <button type="submit" className="btn-primary" disabled={busy || offices.loading} aria-busy={busy || undefined}>{busy ? 'Getting your number…' : 'Get a number'}</button>
          </form>
        )}
      </main>
    </div>
  );
}
