'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';

// Placeholder landing page for the Executive until the campus dashboards arrive.
export default function CampusHome() {
  return (
    <AppShell title="Campus Home" subtitle="Campus-wide compliance will appear here." allowedRoles={[ROLES.EXECUTIVE]}>
      {(user) => (
        <div className="card p-6">
          <p className="text-sm text-slate-700">Welcome, {user.fullName}. The campus dashboards are coming in a later sprint.</p>
        </div>
      )}
    </AppShell>
  );
}
