'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignIn, useAuth } from '@clerk/nextjs';
import { landingForRole } from 'ccms-shared/nav';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import BrandMark from '../../../components/ui/BrandMark.js';
import { BRAND } from '../../../lib/constants/brand.js';
import { PASSWORD_SIGN_IN_PATH, authProvider, clerkEnabled } from '../../../lib/auth/provider.js';
import { completeClerkSignIn, redirectToLogin, sessionRejection } from '../../../lib/auth/session.js';

// Clerk sign-in (Landas 1). Clerk proves who the person is; Identity then decides whether they have CCMS access (a Super Admin
// approves each person once). Sign-up is closed on the shared instance: new staff get an invitation from the instance owner.
function ClerkSignInPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || started.current) return;
    started.current = true;
    completeClerkSignIn()
      .then((user) => {
        if (user) window.location.assign(landingForRole(user.role));
        else if (sessionRejection()) redirectToLogin(); // goes to the "No access yet" page with the reason
        else {
          started.current = false;
          setError('Your sign-in could not be completed. Please try again.');
        }
      })
      .catch((err) => {
        started.current = false;
        setError(err?.message ?? 'Sign-in is not available right now. Please try again in a few minutes.');
      });
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return <p className="text-sm text-slate-600">Loading sign-in…</p>;
  if (isSignedIn) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {!error ? <p className="text-sm text-slate-600">Signing you in to {BRAND.system}…</p> : null}
      </div>
    );
  }
  // Hash routing keeps every Clerk step on this one page, so no catch-all route is needed.
  return <SignIn routing="hash" forceRedirectUrl="/login/clerk" />;
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
