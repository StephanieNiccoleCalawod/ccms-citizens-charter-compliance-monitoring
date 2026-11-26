'use client';

import { ROLES } from 'ccms-shared/roles';
import AccountShell from '../../../components/layout/AccountShell.js';
import SyncPanel from './SyncPanel.js';

// The "Connected systems" panel lives in Settings, its own page, instead of on the Working hours page: it is a status
// view of separate systems (SMS, FMS), not a working-hours setting, so it does not belong inside that form.
export default function ConnectedSystemsPage() {
  return (
    <AccountShell title="Connected systems" subtitle="These are separate systems. CCCMS sends them the campus calendar." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <SyncPanel />
    </AccountShell>
  );
}
