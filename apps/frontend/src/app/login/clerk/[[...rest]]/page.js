'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SignIn, useAuth, useClerk } from '@clerk/nextjs';
import { landingForRole } from 'ccms-shared/nav';
import AuthBrandPanel from '../../../../components/auth/AuthBrandPanel.js';
import ErrorBanner from '../../../../components/feedback/ErrorBanner.js';
import BrandMark from '../../../../components/ui/BrandMark.js';
import { BRAND } from '../../../../lib/constants/brand.js';
import { CLERK_SIGN_IN_PATH, PASSWORD_SIGN_IN_PATH, authProvider, clerkEnabled } from '../../../../lib/auth/provider.js';
import { completeClerkSignIn, redirectToLogin, sessionRejection } from '../../../../lib/auth/session.js';
import { clerkSessionState, pendingTaskLabel } from '../../../../lib/ui/clerk-access.js';
import { plainFailure } from '../../../../lib/ui/save-feedback.js';

// Clerk sign-in (Landas 1), and the sole sign-in in production (NEXT_PUBLIC_AUTH_PROVIDER=clerk). Clerk proves who the person
// is — including "Continue with Google" when the owner's instance has it on — and Identity then decides whether they have CCMS
// access (a Super Admin approves each person once). Sign-up is closed on the shared instance: new staff get an invitation.
//
// Clerk's <SignIn/> sends a visitor who already has a session to its redirect URL, which is this page. So the form is shown
// ONLY when there is no Clerk session at all; a pending session (Clerk still needs a step) must not count as signed out here,
// or the page reloads forever. The form is left at its default appearance so every method the owner enables (Google, email)
// keeps rendering; CCMS never hides a sign-in method.
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
      .catch((err) => setError(plainFailure(err, { fallback: 'Sign-in is not available right now. Please try again in a few minutes.' })));
  }, [state, router]);

  if (state === 'loading') return <p className="text-sm text-[#5F5950]">Loading sign-in…</p>;
  // Path routing (Clerk's way for the Next.js App Router): each step has its own address under /login/clerk, served by this
  // catch-all route (it also serves the Google "sso-callback" step). Hash routing made the App Router reload on every step.
  if (state === 'signed-out') return <SignIn routing="path" path={CLERK_SIGN_IN_PATH} forceRedirectUrl={CLERK_SIGN_IN_PATH} />;

  const email = clerk.user?.primaryEmailAddress?.emailAddress;
  return (
    <div className="w-full space-y-3 rounded-xl border border-[#E7E0D3] bg-white p-5 shadow-sm">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {state === 'pending' ? (
        <p className="text-sm text-[#3A352F]">
          Your PUP account{email ? ` (${email})` : ''} is signed in, but you still need to {pendingTaskLabel(clerk.session)} before you can use {BRAND.system}.
          Sign out, then sign in again and follow the steps.
        </p>
      ) : !error ? (
        <p className="text-sm text-[#5F5950]">
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
  const icon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-[#F7F4EF] lg:flex-row">
      {/* Campus photo panel (shared with the password sign-in page). */}
      <AuthBrandPanel />

      {/* Sign-in panel */}
      <main className="relative flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-16 sm:px-8 lg:w-1/2 lg:px-12 [@media(max-height:760px)]:pb-5 [@media(max-height:760px)]:pt-14">
        <Link
          href="/"
          className="absolute left-5 top-5 inline-flex items-center gap-2 text-sm font-medium xl:top-6 xl:text-base text-[#3A352F] transition-colors hover:text-[#520909] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B] focus-visible:ring-offset-2 sm:left-8 sm:top-8"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0 7 7m-7-7 7-7" />
          </svg>
          Back
        </Link>

        <div className="flex w-full max-w-[440px] flex-col items-center">
          <div className="mb-8 flex flex-col items-center text-center [@media(max-height:760px)]:mb-4">
            <BrandMark size={64} />
            <p className="mt-3 text-lg font-bold leading-tight tracking-tight text-[#2B2724] xl:text-xl">{BRAND.campus}</p>
            <p className="mt-1 text-sm font-medium uppercase tracking-[0.35em] text-[#6F685D]">{BRAND.system}</p>
          </div>

          {enabled ? (
            <ClerkSignInPanel />
          ) : (
            <div className="w-full space-y-3 rounded-xl border border-[#E7E0D3] bg-white p-5 shadow-sm">
              <p className="text-sm text-[#3A352F]">Sign-in with your PUP account is not turned on.</p>
              <Link className="btn-primary inline-block" href={PASSWORD_SIGN_IN_PATH}>
                Go to the sign-in page
              </Link>
            </div>
          )}

          {/* Only in dual mode (local and QA): the way back to the password form. In production (clerk mode) this never shows. */}
          {enabled && authProvider() === 'dual' ? (
            <p className="mt-6 text-center text-xs text-[#6F685D] xl:text-sm">
              Still using your CCMS password?{' '}
              <Link className="btn-link" href={PASSWORD_SIGN_IN_PATH}>
                Sign in with email and password
              </Link>
            </p>
          ) : (
            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[#6F685D] xl:text-sm">
              <svg {...icon} className="h-3.5 w-3.5">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Staff sign-in only
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
