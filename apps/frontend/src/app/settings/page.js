'use client';

import Link from 'next/link';
import AppShell from '../../components/layout/AppShell.js';
import { hubGroups } from '../../lib/ui/settings-hub.js';

// The Settings hub (D8-20 / S8-13): links only. Each link opens the page where that setting already lives.
function Hub({ user }) {
  const groups = hubGroups(user.role);
  if (groups.length === 0) return <p className="text-sm text-slate-500">There are no settings for your role.</p>;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2" data-testid="settings-hub">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`hub-${group.id}`} className="card overflow-hidden">
          <h2 id={`hub-${group.id}`} className="border-b border-line bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-maroon-800">{group.title}</h2>
          <ul className="divide-y divide-line">
            {group.links.map((link) => (
              <li key={link.href + link.label}>
                <Link href={link.href} className="group flex items-center gap-3 px-5 py-4 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-700" data-testid={`hub-link-${link.href}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900 group-hover:text-maroon-800">{link.label}</span>
                    <span className="mt-0.5 block text-sm text-slate-600">{link.hint}</span>
                    {link.readOnly ? <span className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">View only</span> : null}
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-maroon-800" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
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
