'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';

// Placeholder landing page for Office Head and Office Staff until the office screens arrive.
export default function OfficeHome() {
  return (
    <AppShell title="Office Home" subtitle="Your office's work will appear here." allowedRoles={[ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}>
      {(user) => (
        <div className="card p-6">
          <p className="text-sm text-slate-700">Welcome, {user.fullName}. The office screens are coming in a later sprint.</p>
        </div>
      )}
    </AppShell>
  );
}
