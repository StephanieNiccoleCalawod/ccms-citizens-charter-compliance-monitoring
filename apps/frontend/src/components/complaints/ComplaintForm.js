'use client';

import Link from 'next/link';
import { useState } from 'react';
import ErrorBanner from '../feedback/ErrorBanner.js';
import PublicHeader from '../layout/PublicHeader.js';
import { checkTrackingNumber, fileComplaint } from '../../lib/api/complaints.js';
import { CATEGORIES, EMPTY_FORM, LIMITS, TRACKING_NOT_FOUND, TRACKING_REQUIRED, describeFailure, formErrors, foundLine, privacyNoticeUrl, remaining } from '../../lib/ui/complaints.js';

// CC032: a citizen files a complaint without an account. The page keeps nothing after the reference is shown.
// S8-56: step 1 asks for the transaction tracking number and checks it. The rest of the form opens only when it is found; the office is then
// filled in from that transaction and locked.
export default function ComplaintForm() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [tracking, setTracking] = useState(''); // what is typed in step 1
  const [check, setCheck] = useState({ status: 'idle', found: null, message: '' }); // idle | checking | found | notfound | error
  const privacy = privacyNoticeUrl();

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const error = (key) => (errors[key] ? <p id={`c-${key}-error`} className="mt-1 text-xs text-red-700">{errors[key]}</p> : null);
  const aria = (key) => ({ 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `c-${key}-error` : undefined });

  async function runCheck(event) {
    event.preventDefault();
    const value = tracking.trim();
    if (!value) { setCheck({ status: 'notfound', found: null, message: TRACKING_REQUIRED }); return; }
    setCheck({ status: 'checking', found: null, message: '' });
    try {
      const result = await checkTrackingNumber(value);
      if (result?.found) {
        setForm((f) => ({ ...f, tracking_no: value, office_id: result.office_id }));
        setCheck({ status: 'found', found: result, message: '' });
      } else {
        setForm((f) => ({ ...f, tracking_no: '', office_id: '' }));
        setCheck({ status: 'notfound', found: null, message: TRACKING_NOT_FOUND });
      }
    } catch (failure) {
      setCheck({ status: 'error', found: null, message: describeFailure(failure).message });
    }
  }

  function changeNumber() {
    setForm((f) => ({ ...f, tracking_no: '', office_id: '' }));
    setCheck({ status: 'idle', found: null, message: '' });
  }

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
          <div className="space-y-4">
            <form className="card space-y-4 p-6" onSubmit={runCheck} noValidate data-testid="complaint-step-1">
              <div>
                <h1 className="text-xl font-bold text-maroon-950">File a complaint</h1>
                <p className="mt-1 text-sm text-slate-600">You do not need an account. First, confirm the transaction your complaint is about.</p>
              </div>
              <div>
                <label htmlFor="c-tracking" className="label">Enter your transaction tracking number</label>
                <div className="flex flex-wrap items-start gap-3">
                  <input id="c-tracking" className="input min-w-0 flex-1" maxLength={LIMITS.tracking} value={tracking} onChange={(e) => setTracking(e.target.value)} readOnly={check.status === 'found'}
                    aria-invalid={check.status === 'notfound' || undefined} aria-describedby="c-tracking-help" autoComplete="off" />
                  {check.status === 'found' ? (
                    <button type="button" className="btn-secondary" onClick={changeNumber}>Change number</button>
                  ) : (
                    <button type="submit" className="btn-primary" disabled={check.status === 'checking'} aria-busy={check.status === 'checking' || undefined}>{check.status === 'checking' ? 'Checking…' : 'Check'}</button>
                  )}
                </div>
                <p id="c-tracking-help" className="mt-1 text-xs text-slate-500">The number on your acknowledgement slip.</p>
                {check.status === 'notfound' || check.status === 'error' ? <p role="alert" className="mt-2 text-sm text-red-700" data-testid="tracking-not-found">{check.message}</p> : null}
                {check.status === 'found' ? <p role="status" className="mt-2 rounded-control bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" data-testid="tracking-found">{foundLine(check.found)}</p> : null}
              </div>
            </form>

            {check.status === 'found' ? (
              <form className="card space-y-4 p-6" onSubmit={submit} noValidate data-testid="complaint-form">
                <ErrorBanner message={banner} onDismiss={() => setBanner('')} />
                <div>
                  <p className="label">Office and service</p>
                  <p className="input bg-slate-50 text-slate-700" data-testid="complaint-office-locked">{[check.found.office_name, check.found.service_name].filter(Boolean).join(' — ')}</p>
                  {error('office_id')}
                  {error('tracking_no')}
                </div>
                <div>
                  <label htmlFor="c-category" className="label">Category *</label>
                  <select id="c-category" className="input select-chevron" value={form.category} onChange={set('category')} {...aria('category')}>
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
                  <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Sending…' : 'Submit complaint'}</button>
                </div>
              </form>
            ) : null}
            <p className="text-sm"><Link href="/complaint/status" className="btn-link">Already filed? Check the status</Link></p>
          </div>
        )}
      </main>
    </div>
  );
}
