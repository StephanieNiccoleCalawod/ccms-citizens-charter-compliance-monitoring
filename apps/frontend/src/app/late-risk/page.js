'use client';

import AppShell from '../../components/layout/AppShell.js';
import LateRiskSection from '../../components/analytics/LateRiskSection.js';
import { TRANSACTION_PAGE_ROLES } from '../../lib/auth/permissions.js';

export default function LateRiskPage() {
  return (
    <AppShell title="Chance of finishing late" subtitle="Open transactions ranked by how likely they are to miss their deadline." allowedRoles={TRANSACTION_PAGE_ROLES}>
      {(user) => <LateRiskSection key={user.id} user={user} />}
    </AppShell>
  );
}
