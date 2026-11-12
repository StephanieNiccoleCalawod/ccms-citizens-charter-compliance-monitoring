'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ComplaintsPage from '../../components/complaints/ComplaintsPage.js';

// Complaints for staff: Super Admin and Office Head handle them; the Executive reads (K14); Office Staff read their own office while switch STAFF_VIEW_COMPLAINTS is on.
// The public filing form stays at /complaint (no login).
export default function Complaints() {
  return (
    <AppShell title="Complaints" subtitle="Complaints filed by citizens, with their due dates." allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]}>
      {(user) => <ComplaintsPage user={user} />}
    </AppShell>
  );
}
