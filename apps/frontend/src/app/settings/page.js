'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { landingForRole } from 'ccms-shared/nav';
import AccountShell from '../../components/layout/AccountShell.js';
import LoadingState from '../../components/ui/LoadingState.js';
import { defaultSettingsHref } from '../../lib/ui/account-nav.js';

function SettingsRedirect({ user }) {
  const router = useRouter();
  const target = defaultSettingsHref(user.role) ?? landingForRole(user.role);

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return <LoadingState>Opening settings…</LoadingState>;
}

export default function SettingsPage() {
  return (
    <AccountShell title="Settings">
      {(user) => <SettingsRedirect user={user} />}
    </AccountShell>
  );
}
