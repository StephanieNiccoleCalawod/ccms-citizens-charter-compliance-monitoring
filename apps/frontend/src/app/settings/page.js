'use client';

import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import AppShell from '../../components/layout/AppShell.js';
import Card from '../../components/ui/Card.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import { clerkEnabled } from '../../lib/auth/provider.js';
import { ACCESS_LABEL, settingsHubForRole } from '../../lib/ui/settings-hub.js';

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 4 6 6-6 6" />
    </svg>
  );
}

/**
 * The Settings hub (S8-13): every setting the signed-in role can reach, grouped, each one a link to the screen that already holds it.
 * There is no form here and nothing is saved here, so no setting has a second copy; the screens keep using their own APIs, and the
 * services still answer 403 to a role that may not change a setting.
 */
function SettingsHub({ user }) {
  const groups = settingsHubForRole(user.role, { clerk: clerkEnabled() });
  return (
    <div className="space-y-4" data-testid="settings-hub">
      {user.role !== ROLES.SUPER_ADMIN ? <StatusBanner variant="info" message="You can view these settings. Only a Super Admin can change them." /> : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.id} title={group.title} description={group.description} data-testid={`settings-group-${group.id}`}>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    data-testid={`settings-item-${item.id}`}
                    className="flex items-start justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 transition-colors hover:border-pup-maroon hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-pup-maroon"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{item.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
                    </span>
                    <span className="flex shrink-0 items-start gap-2">
                      <StatusBadge variant={item.access === 'edit' ? 'brand' : 'neutral'}>{ACCESS_LABEL[item.access]}</StatusBadge>
                      <Chevron />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell title="Settings" subtitle="Everything you can set up in CCCMS, in one place. Each item opens the screen where it is changed.">
      {(user) => <SettingsHub user={user} />}
    </AppShell>
  );
}
