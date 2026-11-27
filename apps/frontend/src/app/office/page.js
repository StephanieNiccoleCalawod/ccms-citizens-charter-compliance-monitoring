'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import KpiHome from '../../components/home/KpiHome.js';

// Office Home's content for the Office Head now lives on the unified Dashboard (/); this redirects them there
// without breaking the bookmark/old link, while Office Staff keeps this page exactly as before.
function RedirectToDashboard() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return <p className="text-sm text-slate-500" role="status">Taking you to the Dashboard…</p>;
}

// Office Home (CC036): the office's tiles for a period and the own row, for Office Staff only now.
export default function OfficeHome() {
  return (
    <AppShell title="Office Home" subtitle="How your office is doing against the Citizen's Charter." allowedRoles={[ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}>
      {(user) => (user.role === ROLES.OFFICE_HEAD ? <RedirectToDashboard /> : <KpiHome user={user} />)}
    </AppShell>
  );
}
