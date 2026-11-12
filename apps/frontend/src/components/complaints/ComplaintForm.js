'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ErrorBanner from '../feedback/ErrorBanner.js';
import PublicHeader from '../layout/PublicHeader.js';
import { fileComplaint, listPublicOffices } from '../../lib/api/complaints.js';
import { CATEGORIES, EMPTY_FORM, LIMITS, describeFailure, formErrors, privacyNoticeUrl, remaining } from '../../lib/ui/complaints.js';

// CC032: a citizen files a complaint without an account. The page keeps nothing after the reference is shown.
export default function ComplaintForm() {
  const [offices, setOffices] = useState({ items: [], loading: true, failed: false });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const privacy = privacyNoticeUrl();

  useEffect(() => {
    let active = true;
    listPublicOffices().then((items) => active && setOffices({ items, loading: false, failed: false })).catch(() => active && setOffices({ items: [], loading: false, failed: true }));
    return () => { active = false; };
  }, []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const error = (key) => (errors[key] ? <p id={`c-${key}-error`} className="mt-1 text-xs text-red-700">{errors[key]}</p> : null);
  const aria = (key) => ({ 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `c-${key}-error` : undefined });

  async function submit(event) {
    event.preventDefault();
    const found = formErrors(form);
    setErrors(found);
    setBanner('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setDone(await fileComplaint(form));
    } catch (failure) {
      const { message, fields } = describeFailure(failure);
      setBanner(message);
      setErrors(fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {done ? (
          <section className="card space-y-3 p-6" role="status" data-testid="complaint-done">
            <h1 className="text-xl font-bold text-maroon-950">Your complaint was received</h1>
            <p className="text-sm text-slate-700">Your reference number is:</p>
            <p className="text-2xl font-bold tracking-wide text-maroon-900" data-testid="complaint-reference">{done.reference}</p>
            <p className="text-sm text-slate-700">Keep this number. You need it to check the status of your complaint.</p>
            {done.email_sent === true ? <p className="text-sm text-slate-700">We also sent the reference number to your email.</p> : null}
            {done.email_sent === false ? <p className="text-sm text-slate-700">We could not send the reference number by email, so please write it down.</p> : null}
            <p className="text-sm"><Link href={`/complaint/status?ref=${encodeURIComponent(done.reference)}`} className="btn-link">Check the status of this complaint</Link></p>
          </section>
        ) : (
          <form className="card space-y-4 p-6" onSubmit={submit} noValidate data-testid="complaint-form">
            <div>
              <h1 className="text-xl font-bold text-maroon-950">File a complaint</h1>
              <p className="mt-1 text-sm text-slate-600">You do not need an account. Tell us which office and what happened. Your name and email are optional.</p>
            </div>
            <ErrorBanner message={banner} onDismiss={() => setBanner('')} />
            {offices.failed ? <ErrorBanner message="The list of offices could not be loaded. Please reload the page." /> : null}
            <div>
              <label htmlFor="c-office" className="label">Office *</label>
              <select id="c-office" className="input" value={form.office_id} onChange={set('office_id')} disabled={offices.loading} {...aria('office_id')}>
                <option value="">{offices.loading ? 'Loading offices…' : 'Choose an office'}</option>
                {offices.items.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
              </select>
              {error('office_id')}
            </div>
            <div>
              <label htmlFor="c-category" className="label">Category *</label>
              <select id="c-category" className="input" value={form.category} onChange={set('category')} {...aria('category')}>
                <option value="">Choose a category</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {error('category')}
            </div>
            <div>
              <label htmlFor="c-description" className="label">What happened? *</label>
              <textarea id="c-description" className="input" rows={6} maxLength={LIMITS.description} value={form.description} onChange={set('description')} {...aria('description')} />
              <p className="mt-1 text-xs text-slate-500">{remaining(form)} characters left</p>
              {error('description')}
            </div>
            <div>
              <label htmlFor="c-tracking" className="label">Tracking number (optional)</label>
              <input id="c-tracking" className="input" maxLength={LIMITS.tracking} value={form.tracking_no} onChange={set('tracking_no')} {...aria('tracking_no')} />
              <p className="mt-1 text-xs text-slate-500">The number on your acknowledgement, if you have one.</p>
              {error('tracking_no')}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="c-name" className="label">Your name (optional)</label>
                <input id="c-name" className="input" maxLength={LIMITS.name} autoComplete="name" value={form.name} onChange={set('name')} {...aria('name')} />
                {error('name')}
              </div>
              <div>
                <label htmlFor="c-email" className="label">Your email (optional)</label>
                <input id="c-email" type="email" className="input" maxLength={LIMITS.email} autoComplete="email" value={form.email} onChange={set('email')} {...aria('email')} />
                <p className="mt-1 text-xs text-slate-500">We email your reference number here.</p>
                {error('email')}
              </div>
            </div>
            <p className="text-xs text-slate-600">
              We use what you enter only to handle your complaint.{' '}
              {privacy ? <a href={privacy} className="btn-link" target="_blank" rel="noreferrer">Read the privacy notice</a> : null}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-primary" disabled={busy || offices.loading} aria-busy={busy || undefined}>{busy ? 'Sending…' : 'Submit complaint'}</button>
              <Link href="/complaint/status" className="btn-link text-sm">Already filed? Check the status</Link>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
