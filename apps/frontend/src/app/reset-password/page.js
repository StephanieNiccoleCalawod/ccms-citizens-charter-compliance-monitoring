'use client';

import { RequiredMark } from '../../components/forms/Field.js';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PASSWORD_RESET_CONFIRM_API } from '../../lib/api/identity.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import { BRAND } from '../../lib/constants/brand.js';

const MIN_LENGTH = 8;

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters`);
    if (password !== confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      const response = await fetch(PASSWORD_RESET_CONFIRM_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'Something went wrong. Please try again.');
      } else {
        setDone(true);
      }
    } catch {
      setError('Cannot reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <ErrorBanner message="This reset link is invalid or has expired" />
        <Link className="btn-secondary w-full" href="/login">Back to sign in</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-700">Your password has been reset. You can now sign in with the new password.</p>
        <Link className="btn-primary w-full" href="/login">Go to sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label className="label" htmlFor="password">New password<RequiredMark /></label>
        <input id="password" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        <p className="mt-1 text-xs text-slate-500">At least {MIN_LENGTH} characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm new password<RequiredMark /></label>
        <input id="confirm" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
      <ErrorBanner message={error} />
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-5 p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-maroon-800">{BRAND.system} · {BRAND.campus}</p>
          <h1 className="mt-1 text-2xl">Reset your password</h1>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
