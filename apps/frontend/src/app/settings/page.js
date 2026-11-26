'use client';

import { useEffect, useMemo, useState } from 'react';
import AccountShell from '../../components/layout/AccountShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import NotificationCenter from '../../components/notifications/NotificationCenter.js';
import { CATALOGUE_SETTINGS_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { accountNavGroups } from '../../lib/ui/account-nav.js';
import { SettingsManager as TransactionSettingsManager } from './transactions/page.js';

// Read-only: just the institution code Core already holds, if any. The Offices page (full list, search, Add
// Office) is not repeated here - it has its own route and its own entry in the main dashboard nav.
function InstitutionCodeStatus() {
  const [state, setState] = useState({ loading: true, code: null, error: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch(CATALOGUE_SETTINGS_API)
      .then((data) => !cancelled && setState({ loading: false, code: data?.settings?.institution_code ?? null, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, code: null, error: err.message }));
    return () => { cancelled = true; };
  }, []);

  if (state.loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>;
  if (state.error) return <ErrorBanner message={state.error} />;
  return (
    <p className="text-sm text-slate-700" data-testid="institution-code-status">
      {state.code ? (
        <>Institution code: <span className="font-mono font-semibold text-slate-900">{state.code}</span></>
      ) : (
        'The institution code has not been set yet.'
      )}
    </p>
  );
}

// One entry per `scrollId` in lib/ui/account-nav.js's Settings group. Keyed the same way, so the sidebar (built
// from that same list) and this content can never drift apart on which sections exist or in what order. Only the
// simple configuration settings are here - Connected systems, Roles and permissions, Access requests and Security
// and sessions are complex management pages (their own tables/workflows) and stay separate routes, never a section
// of this scroll (see account-nav.js: those items have no `scrollId`).
const SECTIONS = {
  offices: {
    title: 'Institution code',
    subtitle: 'The fixed prefix of every office code (for example PUP-OSAS). Manage offices themselves from the Offices page.',
    render: () => <InstitutionCodeStatus />,
  },
  transactions: {
    title: 'Transaction settings',
    subtitle: 'How transactions behave: hold, counters and automatic closing.',
    render: (user) => <TransactionSettingsManager user={user} />,
  },
  notifications: {
    title: 'Notification Center',
    subtitle: 'Every notice from the bell in one place. Search, filter and mark them as read.',
    render: () => <NotificationCenter />,
  },
};

// General settings (D8-20 / S8-13, extended): every setting the role may reach, as one scrollable page instead of
// a grid of links. The sidebar (AccountShell, scrollSpy) scrolls to a section instead of navigating when it is
// clicked, and highlights whichever section the page has scrolled to; from any other page those same sidebar
// items still navigate to the section's own route (e.g. /settings/security), which keeps working unchanged.
function GeneralSettings({ user }) {
  const scrollIds = useMemo(
    () => (accountNavGroups(user.role).find((g) => g.id === 'settings')?.items ?? []).map((i) => i.scrollId).filter((id) => id && SECTIONS[id]),
    [user.role],
  );

  if (scrollIds.length === 0) return <p className="text-sm text-slate-500">There are no settings for your role.</p>;

  return (
    <div className="space-y-6" data-testid="settings-general">
      {scrollIds.map((id) => {
        const section = SECTIONS[id];
        return (
          <section key={id} id={id} className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby={`${id}-heading`} data-testid={`settings-section-${id}`}>
            <h2 id={`${id}-heading`} className="title-card">{section.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{section.subtitle}</p>
            <div className="mt-4">{section.render(user)}</div>
          </section>
        );
      })}
      {/* So the last section can still be scrolled flush to the top like any other, the same way a page with more
          content below it naturally allows: without this, the scroll stops wherever the document ends. */}
      <div aria-hidden="true" className="h-[70vh]" />
    </div>
  );
}

export default function SettingsHubPage() {
  return (
    <AccountShell title="Settings" subtitle="Every setting, in one place. Scroll, or use the sidebar to jump to a section." scrollSpy>
      {(user) => <GeneralSettings user={user} />}
    </AccountShell>
  );
}
