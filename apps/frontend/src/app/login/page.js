'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import { BRAND } from '../../lib/constants/brand.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE } from '../../lib/auth/guards.js';
import { clearToken, refreshSession, revokeServerSession, sessionRejection, signIn } from '../../lib/auth/session.js';
import { LOGIN_NOTICES, noticeAfterRetry, parseLoginNotice } from '../../lib/auth/sign-out-flow.js';
import BrandMark from '../../components/ui/BrandMark.js';
import AuthBrandPanel from '../../components/auth/AuthBrandPanel.js';

// The ?signed_out=1 retry, shared while it runs so React Strict Mode's second effect run in
// development does not send a second revocation request.
let pendingRetry = null;
function retryRevocation() {
  pendingRetry ??= revokeServerSession().finally(() => {
    pendingRetry = null;
  });
  return pendingRetry;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState(null); // a LOGIN_NOTICES code, never text from the URL
  const [retry, setRetry] = useState({ busy: false, result: null });

  // Already signed in (valid refresh cookie)? Go straight to the role's page.
  // After "Sign out" (?signed_out=1) never do that: Identity could not confirm the sign-out, so try
  // the revocation once more here and only report a failure if this attempt fails too.
  useEffect(() => {
    let cancelled = false;
    const search = window.location.search;
    if (new URLSearchParams(search).has('signed_out')) {
      clearToken();
      const requested = parseLoginNotice(search);
      retryRevocation().then((revoked) => {
        window.history.replaceState(null, '', window.location.pathname);
        if (cancelled) return;
        setNotice(noticeAfterRetry({ requested, retryRevoked: revoked }));
        setChecking(false);
      });
      return () => {
        cancelled = true;
      };
    }
    refreshSession()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          // A client-side navigation (not a full page reload, which would flash a blank page before the
          // Dashboard's own chrome has a chance to paint): the token is already in memory from refreshSession().
          router.push('/');
          return;
        }
        // A session whose role is not recognized was dropped: say why and keep the form here.
        if (sessionRejection() === ROLE_NOT_RECOGNIZED) setError(ROLE_NOT_RECOGNIZED_MESSAGE);
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.push('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function retryRevoke() {
    setRetry({ busy: true, result: null });
    const revoked = await revokeServerSession();
    if (revoked) setNotice(null);
    setRetry({ busy: false, result: revoked ? 'revoked' : 'failed' });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F4EF] text-sm text-[#7A756D]">
        Checking your session…
      </div>
    );
  }

  const field =
    'h-12 w-full rounded-xl xl:h-[52px] xl:rounded-[14px] xl:text-base border border-[#D9D2C5] bg-white text-[15px] text-[#2B2724] placeholder:text-[#837C71] transition-colors hover:border-[#B9AFA0] focus:border-[#520909] focus:outline-none focus:ring-2 focus:ring-[#520909]/20';
  const icon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-[#F7F4EF] lg:flex-row">
      {/* Campus photo panel (shared with the Clerk sign-in page). */}
      <AuthBrandPanel />

      {/* Sign-in panel */}
      <main className="relative flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-16 sm:px-8 lg:w-1/2 lg:px-12 [@media(max-height:760px)]:pb-5 [@media(max-height:760px)]:pt-14">
        <Link
          href="/"
          className="absolute left-5 top-5 inline-flex min-h-6 items-center gap-2 text-sm font-medium xl:top-6 xl:text-base text-[#3A352F] transition-colors hover:text-[#520909] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B] focus-visible:ring-offset-2 sm:left-8 sm:top-8"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0 7 7m-7-7 7-7" />
          </svg>
          Back
        </Link>
        <div className="w-full max-w-[400px] xl:max-w-[460px]">
          <div className="mb-8 flex flex-col items-center text-center xl:mb-8 [@media(max-height:760px)]:mb-4">
            <BrandMark size={64} />
            <p className="mt-3 text-lg font-bold leading-tight tracking-tight text-[#2B2724] xl:mt-3 xl:text-xl">{BRAND.campus}</p>
            <p className="mt-1 text-sm font-medium uppercase tracking-[0.35em] text-[#6F685D] xl:text-base">{BRAND.system}</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5 [@media(max-height:760px)]:space-y-3" noValidate>
            {notice ? (
              <div className="space-y-2">
                <ErrorBanner message={LOGIN_NOTICES[notice]} />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-secondary btn-sm" onClick={retryRevoke} disabled={retry.busy}>
                    {retry.busy ? 'Trying again…' : 'Try again'}
                  </button>
                  {retry.result === 'failed' ? (
                    <span role="status" className="text-xs text-slate-600">
                      Still could not reach the server.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : retry.result === 'revoked' ? (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                The server confirmed that your session has ended.
              </p>
            ) : null}

            <header className="pb-1">
              <h2 className="font-sans text-[34px] font-bold leading-tight tracking-tight text-[#3D0606] xl:text-[40px] [@media(max-height:760px)]:text-[32px]">Welcome back</h2>
              <p className="mt-2 text-[15px] text-[#5F5950] xl:mt-2 xl:text-base">Sign in with your CCCMS staff account.</p>
            </header>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-[#3A352F] xl:text-base" htmlFor="email">
                Email
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 text-[#7A7266]">
                  <svg {...icon} className="h-5 w-5">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className={`${field} pl-12 pr-4`}
                  placeholder="you@pup.edu.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-[#3A352F] xl:text-base" htmlFor="password">
                Password
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 text-[#7A7266]">
                  <svg {...icon} className="h-5 w-5">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={`${field} pl-12 pr-14`}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-lg text-[#520909] transition-colors hover:bg-[#520909]/5 hover:text-[#6B0F0F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  <svg {...icon} className="h-5 w-5">
                    {showPassword ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <path d="m1 1 22 22" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-[#520909] text-[15px] font-semibold text-white xl:h-[52px] xl:rounded-[14px] xl:text-base shadow-sm transition-colors duration-150 hover:bg-[#6B0F0F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <ErrorBanner message={error} />

            <p className="text-center text-[13px] leading-relaxed text-[#5F5950] xl:text-[15px]">
              Forgot your password? Ask a Super Admin to send you a reset link.
            </p>
          </form>

          <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-[#6F685D] xl:mt-8 xl:text-sm [@media(max-height:760px)]:mt-4">
            <svg {...icon} className="h-3.5 w-3.5">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Staff sign-in only
          </p>
        </div>
      </main>
    </div>
  );
}
