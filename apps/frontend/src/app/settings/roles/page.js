'use client';

import { useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import Button from '../../../components/ui/Button.js';
import LoadingState from '../../../components/ui/LoadingState.js';
import PermissionSwitches from '../../../components/account/PermissionSwitches.js';
import RolesMatrix from '../../../components/account/RolesMatrix.js';
import { getPermissionSwitches, savePermissionSwitches } from '../../../lib/api/account.js';
import { switchValues } from '../../../lib/ui/account.js';

/** The same glyph the sidebar uses for Transaction Settings: a settings/sliders icon. */
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />
    </svg>
  );
}

function RolesAndPermissions() {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [switchesOpen, setSwitchesOpen] = useState(false);
  // Changes every time the modal is opened, so PermissionSwitches remounts with a clean slate (the actual saved
  // values, not a cancelled draft from the last time it was open) instead of needing a reset effect.
  const [switchesKey, setSwitchesKey] = useState(0);

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
  if (!view) return <LoadingState>Loading permissions…</LoadingState>;
  return (
    <div className="space-y-6">
      <section aria-labelledby="matrix-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="matrix-h" className="title-section">Roles and permissions</h2>
          <Button leadingIcon={<SlidersIcon />} onClick={() => { setSwitchesKey((k) => k + 1); setSwitchesOpen(true); }}>
            Manage Staff Permissions
          </Button>
        </div>
        <p className="text-sm text-slate-600">What each role can do. This table is read-only: only the four switches in Manage Staff Permissions can be changed.</p>
        <RolesMatrix matrix={view.matrix} switchOn={switchValues(view.switches)} />
      </section>
      <PermissionSwitches key={switchesKey} open={switchesOpen} onClose={() => setSwitchesOpen(false)} view={view} onSaved={setView} save={savePermissionSwitches} />
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
