'use client';

import { useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import PermissionSwitches from '../../../components/account/PermissionSwitches.js';
import RolesMatrix from '../../../components/account/RolesMatrix.js';
import { getPermissionSwitches, savePermissionSwitches } from '../../../lib/api/account.js';
import { switchValues } from '../../../lib/ui/account.js';

function RolesAndPermissions() {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPermissionSwitches()
      .then((data) => !cancelled && setView(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <section className="card p-6" aria-labelledby="switches-h">
        <h2 id="switches-h" className="text-lg">Staff permission switches</h2>
        <p className="mb-5 mt-1 text-sm text-slate-600">All four are off by default. A change applies to staff accounts on their next action; they do not need to sign in again.</p>
        <PermissionSwitches view={view} onSaved={setView} save={savePermissionSwitches} />
      </section>
      <section aria-labelledby="matrix-h" className="space-y-3">
        <h2 id="matrix-h" className="text-lg">Roles and permissions</h2>
        <p className="text-sm text-slate-600">What each role can do. This table is read-only: only the four switches above can be changed.</p>
        <RolesMatrix matrix={view.matrix} switchOn={switchValues(view.switches)} />
      </section>
    </div>
  );
}

export default function RolesPage() {
  return (
    <AppShell title="Roles and permissions" subtitle="The four staff switches and what every role can do." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <RolesAndPermissions />
    </AppShell>
  );
}
