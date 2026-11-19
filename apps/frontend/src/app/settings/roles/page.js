'use client';

import { useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import PermissionSwitches from '../../../components/account/PermissionSwitches.js';
import RolesMatrix from '../../../components/account/RolesMatrix.js';
import ConfirmDialog from '../../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import AppShell from '../../../components/layout/AppShell.js';
import Button from '../../../components/ui/Button.js';
import LoadingState from '../../../components/ui/LoadingState.js';
import { getPermissionSwitches, savePermissionSwitches } from '../../../lib/api/account.js';
import { ACCOUNTS_API } from '../../../lib/api/identity.js';
import { apiFetch } from '../../../lib/auth/session.js';
import { affectedRolesForSwitch, switchValues } from '../../../lib/ui/account.js';
import { notify } from '../../../lib/ui/notify.js';
import { useSingleSubmit } from '../../../lib/ui/useSingleSubmit.js';

/** The same glyph the sidebar uses for Transaction Settings: a settings/sliders icon. */
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />
    </svg>
  );
}

function RolesAndPermissions({ user }) {
  const [view, setView] = useState(null);
  const [roleCounts, setRoleCounts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [switchesOpen, setSwitchesOpen] = useState(false);
  const [switchesKey, setSwitchesKey] = useState(0);
  const [pendingToggle, setPendingToggle] = useState(null); // { row, role, switchKey, nextEnabled }
  const [savingSwitchKey, setSavingSwitchKey] = useState(null);
  const once = useSingleSubmit();

  const canManageSwitches = user?.role === ROLES.SUPER_ADMIN;

  useEffect(() => {
    let cancelled = false;
    getPermissionSwitches()
      .then(async (data) => {
        if (cancelled) return;
        setView(data);
        const roles = data?.matrix?.roles ?? [];
        if (roles.length === 0) return;
        const settled = await Promise.allSettled(
          roles.map((r) => apiFetch(`${ACCOUNTS_API}?role=${encodeURIComponent(r.role)}&status=active&page=1&pageSize=1`)),
        );
        if (cancelled) return;
        const counts = {};
        settled.forEach((res, idx) => {
          if (res.status === 'fulfilled' && typeof res.value?.total === 'number') {
            counts[roles[idx].role] = res.value.total;
          }
        });
        if (Object.keys(counts).length > 0) setRoleCounts(counts);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  function requestSwitchToggle(target) {
    if (!canManageSwitches || savingSwitchKey !== null) return;
    setSaveError(null);
    setPendingToggle(target);
  }

  async function confirmSwitchToggle() {
    if (!pendingToggle || !canManageSwitches) return;
    const { row, switchKey, nextEnabled } = pendingToggle;
    await once(async () => {
      setSavingSwitchKey(switchKey);
      setSaveError(null);
      try {
        const nextView = await savePermissionSwitches({ [switchKey]: nextEnabled });
        setView(nextView);
        setPendingToggle(null);
        notify.success(`${row.label} ${nextEnabled ? 'enabled' : 'disabled'}.`);
      } catch (err) {
        const message = err?.message || 'Could not update permission switch. Please try again.';
        setSaveError(message);
        setPendingToggle(null);
        notify.error(message);
      } finally {
        setSavingSwitchKey(null);
      }
    });
  }

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!view) return <LoadingState>Loading permissions…</LoadingState>;

  const pendingAffectedRoles = pendingToggle
    ? affectedRolesForSwitch(view.matrix, pendingToggle.switchKey)
    : [];
  const pendingSwitchInfo = pendingToggle
    ? (view.switches ?? []).find((s) => s.key === pendingToggle.switchKey)
    : null;

  return (
    <div className="space-y-4">
      <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-sans text-sm text-[#64748B]">
          Only the four configurable permission switches can be toggled directly in the matrix or via Manage Staff Permissions; fixed role permissions remain read-only.
        </p>
        {canManageSwitches ? (
          <Button
            leadingIcon={<SlidersIcon />}
            onClick={() => {
              setSwitchesKey((k) => k + 1);
              setSwitchesOpen(true);
            }}
          >
            Manage Staff Permissions
          </Button>
        ) : null}
      </div>

      <RolesMatrix
        matrix={view.matrix}
        switches={view.switches}
        switchOn={switchValues(view.switches)}
        roleCounts={roleCounts}
        canToggle={canManageSwitches}
        busySwitchKey={savingSwitchKey}
        onToggleSwitch={requestSwitchToggle}
      />

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title={pendingToggle?.nextEnabled ? 'Enable permission switch?' : 'Disable permission switch?'}
        message={
          pendingToggle
            ? `Change "${pendingToggle.row.label}" from ${pendingToggle.nextEnabled ? 'Off (switch off)' : 'Yes (switch on)'} to ${pendingToggle.nextEnabled ? 'Yes (switch on)' : 'Off (switch off)'}?`
            : ''
        }
        confirmLabel={pendingToggle?.nextEnabled ? 'Enable Switch' : 'Disable Switch'}
        busy={savingSwitchKey !== null}
        busyLabel="Saving…"
        onConfirm={confirmSwitchToggle}
        onCancel={() => {
          if (savingSwitchKey === null) setPendingToggle(null);
        }}
      >
        {pendingToggle ? (
          <div className="mt-3 space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs text-[#202938]">
            <div>
              <span className="font-semibold text-[#64748B]">Affected role(s): </span>
              <span className="font-semibold">
                {pendingAffectedRoles.map((r) => r.label).join(', ') || pendingToggle.role?.label}
              </span>
            </div>
            {pendingSwitchInfo?.description ? (
              <p className="text-[#64748B]">{pendingSwitchInfo.description}</p>
            ) : null}
            <p className="text-[#64748B]">
              This change persists immediately in the backend, is enforced on the next API request, and is recorded in the audit log.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>

      <PermissionSwitches
        key={switchesKey}
        open={switchesOpen}
        onClose={() => setSwitchesOpen(false)}
        view={view}
        onSaved={setView}
        save={savePermissionSwitches}
      />
    </div>
  );
}

export default function RolesPage() {
  return (
    <AppShell
      title="Roles and Permissions"
      subtitle="Manage system capabilities and access permissions across CCCMS user roles."
      allowedRoles={[ROLES.SUPER_ADMIN]}
    >
      {(user) => <RolesAndPermissions user={user} />}
    </AppShell>
  );
}
