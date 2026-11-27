'use client';

import { useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import PermissionConfirmModal from '../../../components/account/PermissionConfirmModal.js';
import PermissionSwitches from '../../../components/account/PermissionSwitches.js';
import RolesMatrix from '../../../components/account/RolesMatrix.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import AccountShell from '../../../components/layout/AccountShell.js';
import Button from '../../../components/ui/Button.js';
import LoadingState from '../../../components/ui/LoadingState.js';
import { getPermissionSwitches, savePermissionSwitches } from '../../../lib/api/account.js';
import { ACCOUNTS_API } from '../../../lib/api/identity.js';
import { OFFICES_API } from '../../../lib/api/catalogue.js';
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

export function RolesAndPermissions({ user }) {
  const [view, setView] = useState(null);
  const [roleCounts, setRoleCounts] = useState(null);
  const [offices, setOffices] = useState([]);
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

  // For the confirmation modal's Office scope -> Specific Office picker (real offices, not mock data).
  useEffect(() => {
    let cancelled = false;
    apiFetch(OFFICES_API).then(({ items }) => !cancelled && setOffices(items ?? [])).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function requestSwitchToggle(target) {
    if (!canManageSwitches || savingSwitchKey !== null) return;
    setSaveError(null);
    setPendingToggle(target);
  }

  async function confirmSwitchToggle(value) {
    if (!pendingToggle || !canManageSwitches) return;
    const { row, switchKey, nextEnabled } = pendingToggle;
    const payload = value !== undefined ? value : nextEnabled;
    await once(async () => {
      setSavingSwitchKey(switchKey);
      setSaveError(null);
      try {
        const nextView = await savePermissionSwitches({ [switchKey]: payload });
        setView(nextView);
        setPendingToggle(null);
        if (!nextEnabled) {
          notify.success(`${row.label} disabled.`);
        } else if (payload && typeof payload === 'object' && payload.scope === 'SPECIFIC') {
          const count = payload.office_ids?.length ?? 0;
          notify.success(`${row.label} enabled for ${count} ${count === 1 ? 'office' : 'offices'}.`);
        } else {
          notify.success(`${row.label} enabled.`);
        }
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
        offices={offices}
        roleCounts={roleCounts}
        canToggle={canManageSwitches}
        busySwitchKey={savingSwitchKey}
        onToggleSwitch={requestSwitchToggle}
      />

      <PermissionConfirmModal
        key={pendingToggle ? `${pendingToggle.switchKey}-${pendingToggle.nextEnabled}-${pendingSwitchInfo?.scope ?? 'ALL'}-${(pendingSwitchInfo?.office_ids ?? []).join(',')}` : 'closed'}
        open={Boolean(pendingToggle)}
        pending={pendingToggle}
        switchInfo={pendingSwitchInfo}
        affectedRoles={pendingAffectedRoles}
        offices={offices}
        busy={savingSwitchKey !== null}
        onConfirm={confirmSwitchToggle}
        onCancel={() => {
          if (savingSwitchKey === null) setPendingToggle(null);
        }}
      />

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
    <AccountShell
      title="Roles and Permissions"
      subtitle="Manage system capabilities and access permissions across CCCMS user roles."
      allowedRoles={[ROLES.SUPER_ADMIN]}
    >
      {(user) => <RolesAndPermissions user={user} />}
    </AccountShell>
  );
}
