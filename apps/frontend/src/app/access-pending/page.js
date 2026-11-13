'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { landingForRole } from 'ccms-shared/nav';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Button from '../../components/ui/Button.js';
import { BRAND } from '../../lib/constants/brand.js';
import { accessPendingCopy } from '../../lib/ui/clerk-access.js';
import { completeClerkSignIn, sessionRejection, signOut } from '../../lib/auth/session.js';

// "No access yet" (Shared Clerk Access Playbook, flow B): the person signed in with Clerk, but a CCMS Super Admin has not
// approved them, or their CCMS access is turned off. Nothing here grants access; "Check again" only asks Identity again.
// The ?reason= code from the address (read on the client; the server render uses the default message).
const noSubscription = () => () => {};
const reasonFromAddress = () => new URLSearchParams(window.location.search).get('reason');
const noReason = () => null;

export default function AccessPendingPage() {
  const router = useRouter();
  const addressReason = useSyncExternalStore(noSubscription, reasonFromAddress, noReason);
  const [checkedReason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reason = checkedReason ?? addressReason;
  const copy = accessPendingCopy(reason);

  async function checkAgain() {
    setBusy(true);
    setError(null);
    try {
      const user = await completeClerkSignIn();
      if (user) {
        // A client-side navigation, not a full reload: the token is already set, so the next page can paint
        // straight away instead of flashing a blank tab while the whole app re-downloads and re-initializes.
        router.push(landingForRole(user.role));
        return;
      }
      const code = sessionRejection();
      if (code && code !== reason) setReason(code);
      else if (!code) setError('You are signed out. Please sign in again.');
    } catch (err) {
      setError(err?.message ?? 'Please try again in a few minutes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="card w-full max-w-md space-y-5 p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-maroon-800">{BRAND.system} &middot; {BRAND.campus}</p>
          <h1 className="mt-1 text-2xl">{copy.title}</h1>
        </div>
        <p className="text-sm text-slate-700">{copy.body}</p>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <div className="flex flex-wrap gap-2">
          {copy.canRetry ? (
            <Button onClick={checkAgain} loading={busy} loadingLabel="Checking…">Check again</Button>
          ) : null}
          <Button variant="secondary" onClick={() => signOut()} disabled={busy}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
