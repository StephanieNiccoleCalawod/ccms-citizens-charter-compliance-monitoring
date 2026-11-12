'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import KpiHome from '../../components/home/KpiHome.js';

// Campus Home (CC037): campus-wide tiles for a period and one row per office. No per-staff figures for the Executive.
export default function CampusHome() {
  return (
    <AppShell title="Campus Home" subtitle="Campus-wide compliance with the Citizen's Charter." allowedRoles={[ROLES.EXECUTIVE]}>
      {(user) => <KpiHome user={user} />}
    </AppShell>
  );
}
