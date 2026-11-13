'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Clerk sign-in access moved into the Accounts page as its "Clerk Sign-in Access" tab (it is no longer a sidebar item of
// its own). This address is kept working, not removed, so an old bookmark or link still goes somewhere useful instead of
// breaking: it sends the visitor straight to that tab. Access to the tab itself is still Super Admin only (enforced by the
// Accounts page's AppShell, and by Identity on every call).
export default function ClerkAccessRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/accounts?tab=clerk');
  }, [router]);
  return null;
}
