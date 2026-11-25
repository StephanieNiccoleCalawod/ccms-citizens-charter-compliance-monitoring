'use client';

import Link from 'next/link';
import AppShell from '../../components/layout/AppShell.js';
import { hubGroups } from '../../lib/ui/settings-hub.js';

// The Settings hub (D8-20 / S8-13): links only. Each link opens the page where that setting already lives.
function Hub({ user }) {
  const groups = hubGroups(user.role);
  if (groups.length === 0) return <p className="text-sm text-slate-500">There are no settings for your role.</p>;
  return (
    <div className="space-y-6" data-testid="settings-hub">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`hub-${group.id}`}>
          <h2 id={`hub-${group.id}`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group.title}</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="card block p-4 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700" data-testid={`hub-link-${link.href}`}>
                  <span className="block font-semibold text-slate-900">{link.label}</span>
                  <span className="mt-1 block text-sm text-slate-600">{link.hint}</span>
                  {link.readOnly ? <span className="mt-2 block text-xs text-slate-500">You can view this. Only a Super Admin can change it.</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function SettingsHubPage() {
  return (
    <AppShell title="Settings" subtitle="Find the setting you need. Each link opens the page where it is changed.">
      {(user) => <Hub user={user} />}
    </AppShell>
  );
}
