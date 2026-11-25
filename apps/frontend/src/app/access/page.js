'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AccessPage from '../../components/access/AccessPage.js';
import AppShell from '../../components/layout/AppShell.js';

// Request Access (S8-52): Office Head and Office Staff ask for an extra permission; the Super Admin grants it with an end date, denies it, or removes it later.
function Content({ user }) {
  const initialKey = useSearchParams().get('permission') ?? '';
  return <AccessPage user={user} initialKey={initialKey} />;
}

export default function Access() {
  return (
    <AppShell title="Access" subtitle="Ask for extra access for a limited time, or decide the requests." allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}
      breadcrumb={[{ label: 'Settings', href: '/settings' }, { label: 'Access' }]}>
      {(user) => <Suspense fallback={null}><Content user={user} /></Suspense>}
    </AppShell>
  );
}
