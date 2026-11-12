'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import KpiHome from '../../components/home/KpiHome.js';

// Office Home (CC036): the office's tiles for a period, the per-staff table for the Office Head, the own row for Office Staff.
export default function OfficeHome() {
  return (
    <AppShell title="Office Home" subtitle="How your office is doing against the Citizen's Charter." allowedRoles={[ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}>
      {(user) => <KpiHome user={user} />}
    </AppShell>
  );
}
