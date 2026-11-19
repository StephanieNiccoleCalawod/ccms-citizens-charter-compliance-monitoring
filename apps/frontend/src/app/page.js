'use client';

import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell.js';
import DashboardAnalytics from '../components/dashboard/DashboardAnalytics.js';
import LandingHero from '../components/public/LandingHero.js';
import { mightBeSignedIn, refreshSession } from '../lib/auth/session.js';

// Signed in: the main Dashboard inside the app shell, consolidated around live analytics and monitoring.
function SignedInHome() {
  return (
    <AppShell title="Dashboard" subtitle="Compliance, forecasting, and charter performance at a glance.">
      {(user) => <DashboardAnalytics user={user} />}
    </AppShell>
  );
}

export default function Landing() {
  // Keep the server render and the first browser render identical. Session state is browser-only,
  // so choose the public or signed-in page after hydration in the effect below.
  const [mode, setMode] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    if (!mightBeSignedIn()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only session check after hydration (see the comment above)
      setMode('public');
      return () => { cancelled = true; };
    }
    const check = refreshSession();
    check
      .then((user) => {
        if (!cancelled) setMode(user ? 'signed-in' : 'public');
      })
      .catch(() => {
        if (!cancelled) setMode('public');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'signed-in') return <SignedInHome />;
  if (mode === 'public') return <LandingHero />;
  return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">Checking your session…</div>;
}
