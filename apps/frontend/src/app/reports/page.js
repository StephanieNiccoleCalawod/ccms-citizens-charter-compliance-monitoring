'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ReportsPage from '../../components/reports/ReportsPage.js';

// Reports: Office Head and Super Admin generate, publish and correct; the Executive reads published reports (K14: read only); Office Staff read their own office's published reports while switch STAFF_VIEW_REPORTS is on.
export default function Reports() {
  return (
    <AppShell title="Reports" subtitle="Office accomplishment reports for a period." allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]}>
      {(user) => <ReportsPage user={user} />}
    </AppShell>
  );
}
