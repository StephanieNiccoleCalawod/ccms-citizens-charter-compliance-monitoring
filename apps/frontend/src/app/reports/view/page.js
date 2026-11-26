'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ReportView from '../../../components/reports/ReportView.js';

// The dedicated report page: where Generate Report (office or person) and Open on the Reports table land,
// instead of showing the result inside the modal or swapping it in on /reports itself.
export default function ReportViewPage() {
  return (
    <AppShell title="Reports" subtitle="Office accomplishment reports for a period." allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]}>
      {(user) => <ReportView user={user} />}
    </AppShell>
  );
}
