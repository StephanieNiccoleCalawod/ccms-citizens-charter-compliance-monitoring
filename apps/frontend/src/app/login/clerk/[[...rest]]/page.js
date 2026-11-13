'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SignIn, useAuth, useClerk } from '@clerk/nextjs';
import { landingForRole } from 'ccms-shared/nav';
import ErrorBanner from '../../../../components/feedback/ErrorBanner.js';
import BrandMark from '../../../../components/ui/BrandMark.js';
import { BRAND } from '../../../../lib/constants/brand.js';
import { CLERK_SIGN_IN_PATH, PASSWORD_SIGN_IN_PATH, authProvider, clerkEnabled } from '../../../../lib/auth/provider.js';
import { completeClerkSignIn, redirectToLogin, sessionRejection } from '../../../../lib/auth/session.js';
import { clerkSessionState, pendingTaskLabel } from '../../../../lib/ui/clerk-access.js';

// Clerk sign-in (Landas 1). Clerk proves who the person is; Identity then decides whether they have CCMS access (a Super Admin
// approves each person once). Sign-up is closed on the shared instance: new staff get an invitation from the instance owner.
//
// Clerk's <SignIn/> sends a visitor who already has a session to its redirect URL, which is this page. So the form is shown
// ONLY when there is no Clerk session at all; a pending session (Clerk still needs a step) must not count as signed out here,
// or the page reloads forever.
function ClerkSignInPanel() {
  const router = useRouter();
  const clerk = useClerk();
  const { isLoaded } = useAuth({ treatPendingAsSignedOut: false });
  const state = isLoaded ? clerkSessionState(clerk.session) : 'loading';
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (state !== 'active' || started.current) return;
    started.current = true;
    completeClerkSignIn()
      .then((user) => {
        // A client-side navigation, not a full reload: the token is already set, so the destination paints
        // straight away instead of flashing a blank tab while the whole app re-downloads and re-initializes.
        if (user) router.push(landingForRole(user.role));
        else if (sessionRejection()) redirectToLogin(); // goes to the "No access yet" page with the reason
        else setError('Your sign-in could not be completed. Sign out and sign in again.');
      })
      .catch((err) => setError(err?.message ?? 'Sign-in is not available right now. Please try again in a few minutes.'));
  }, [state, router]);

  if (state === 'loading') return <p className="text-sm text-slate-600">Loading sign-in…</p>;
  // Path routing (Clerk's way for the Next.js App Router): each step has its own address under /login/clerk, served by this
  // catch-all route. Hash routing made the App Router reload the page on every step, so the form never finished loading.
  if (state === 'signed-out') return <SignIn routing="path" path={CLERK_SIGN_IN_PATH} forceRedirectUrl={CLERK_SIGN_IN_PATH} />;

  const email = clerk.user?.primaryEmailAddress?.emailAddress;
  return (
    <div className="card space-y-3">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {state === 'pending' ? (
        <p className="text-sm text-slate-700">
          Your PUP account{email ? ` (${email})` : ''} is signed in, but you still need to {pendingTaskLabel(clerk.session)} before you can use {BRAND.system}.
          Sign out, then sign in again and follow the steps.
        </p>
      ) : !error ? (
        <p className="text-sm text-slate-600">
          Signing you in to {BRAND.system}
          {email ? ` as ${email}` : ''}…
        </p>
      ) : null}
      {state === 'pending' || error ? (
        <button type="button" className="btn-secondary" onClick={() => clerk.signOut({ redirectUrl: '/login/clerk' })}>
          Sign out
        </button>
      ) : null}
    </div>
  );
}

export default function ClerkSignInPage() {
  const enabled = clerkEnabled();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold text-slate-800">{BRAND.system}</p>
            <p className="text-xs text-slate-500">{BRAND.campus}</p>
          </div>
        </div>
        {enabled ? (
          <ClerkSignInPanel />
        ) : (
          <div className="card space-y-3">
            <p className="text-sm text-slate-700">Sign-in with your PUP account is not turned on.</p>
            <Link className="btn-primary inline-block" href={PASSWORD_SIGN_IN_PATH}>
              Go to the sign-in page
            </Link>
          </div>
        )}
        {enabled && authProvider() === 'dual' ? (
          <p className="text-center text-xs text-slate-500">
            Still using your CCMS password?{' '}
            <Link className="btn-link" href={PASSWORD_SIGN_IN_PATH}>
              Sign in with email and password
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
