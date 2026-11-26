'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { landingForRole } from 'ccms-shared/nav';
import { ROLE_LABELS } from 'ccms-shared/roles';
import { activeNavHref } from '../../lib/auth/permissions.js';
import { accountNavGroups, accountNavItems } from '../../lib/ui/account-nav.js';
import { BRAND } from '../../lib/constants/brand.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE, isRoleAllowed } from '../../lib/auth/guards.js';
import { getAccessToken, redirectToLogin, refreshSession, sessionRejection } from '../../lib/auth/session.js';
import { useSignOut } from '../../lib/auth/useSignOut.js';
import { initials } from '../../lib/ui/account.js';
import { useScrollSpy } from '../../lib/ui/scroll-spy.js';
import Breadcrumb from '../navigation/Breadcrumb.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ResultModal from '../feedback/ResultModal.js';
import Toaster from '../feedback/Toaster.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import BrandMark from '../ui/BrandMark.js';
import PageHeader from './PageHeader.js';
import IconButton from '../ui/IconButton.js';
import RowActionMenu from '../ui/RowActionMenu.js';
import SessionGuard from '../auth/SessionGuard.js';

/**
 * The dedicated Account Settings layout: its own sidebar (My account, the Settings hub pages, Sign out) and content
 * area, separate from the main CCMS dashboard shell (AppShell) and its sidebar. Reached from the account dropdown in
 * AppShell's header ("My account" / "Settings"), and used by every page that sidebar links to, so the whole section
 * keeps one consistent chrome. Every item routes to an existing page (see lib/ui/account-nav.js); none is new.
 * `scrollSpy`: for the Settings general page, which renders every settings section inline. The Settings group's
 * items then scroll to their own section (by `scrollId`) instead of navigating, and the sidebar highlights
 * whichever section is currently in view.
 */
export default function AccountShell({ title, subtitle, eyebrow, breadcrumb, headerRight, allowedRoles, pageClassName, titleClassName, subtitleClassName, scrollSpy = false, children }) {
  const pathname = usePathname();
  const [state, setState] = useState({ status: 'loading', user: null, message: null });
  const [menuOpen, setMenuOpen] = useState(false); // the sidebar, as a drawer below md
  const [settingsOpen, setSettingsOpen] = useState(true);
  const signOutControl = useSignOut();
  const signOutButtonRef = useRef(null);
  const avatarButtonRef = useRef(null);

  // Computed ahead of the loading/error early returns below, so this hook is always called in the same order.
  // On a page with `scrollSpy`, the Settings group's items scroll to their own section instead of navigating
  // (see the per-item rendering further down); scrollIds is empty, and the hook a no-op, everywhere else.
  const groups = state.user ? accountNavGroups(state.user.role) : [];
  const scrollIds = scrollSpy ? (groups.find((g) => g.id === 'settings')?.items ?? []).filter((i) => i.scrollId).map((i) => i.scrollId) : [];
  const { activeId: activeScrollId, goTo: scrollTo } = useScrollSpy(scrollIds);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((user) => {
        if (cancelled) return;
        if (user) setState({ status: 'ready', user, message: null });
        else if (sessionRejection() === ROLE_NOT_RECOGNIZED) setState({ status: 'rejected', user: null, message: ROLE_NOT_RECOGNIZED_MESSAGE });
        else redirectToLogin();
      })
      .catch((err) => !cancelled && setState({ status: 'error', user: null, message: err.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const timer = setInterval(async () => {
      try {
        if (!(await getAccessToken())) redirectToLogin();
      } catch {
        /* offline: try again on the next tick */
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [state.status]);

  if (state.status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-page text-sm text-slate-500">Checking your session…</div>;
  }
  if (state.status === 'rejected') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-page px-4">
        <ErrorBanner message={state.message} />
        <a className="btn-primary" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-page px-4">
        <ErrorBanner message={state.message} />
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { user } = state;
  const activeHref = activeNavHref(accountNavItems(user.role), pathname);
  const settingsGroupActive = groups.find((g) => g.id === 'settings')?.items.some((item) => item.href === activeHref) ?? false;
  const allowed = isRoleAllowed(user, allowedRoles);

  return (
    <div className="min-h-screen bg-page md:flex">
      {!menuOpen ? null : <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <aside
        id="account-sidebar"
        aria-label="Account settings sidebar"
        className={`font-sans fixed inset-y-0 left-0 z-40 w-72 shrink-0 overflow-y-auto border-r border-line bg-white transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 md:visible md:self-start ${
          menuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
          <BrandMark size={32} />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold leading-tight tracking-tight text-ink">{BRAND.campus}</p>
            <p className="truncate text-[10px] font-semibold leading-tight text-maroon-700 mt-0.5">Account Settings</p>
          </div>
        </div>

        <nav className="space-y-6 px-2.5 py-5" aria-label="Account settings navigation">
          {groups.map((group) => {
            const isSettings = group.id === 'settings';
            const open = !isSettings || settingsOpen;
            return (
              <div key={group.id}>
                {isSettings ? (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen((v) => !v)}
                    aria-expanded={open}
                    aria-controls={`account-group-${group.id}`}
                    className="mb-2 flex w-full items-center justify-between rounded-md px-3.5 py-1 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-ink-muted hover:text-maroon-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-maroon-700"
                  >
                    {group.title.toUpperCase()}
                    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 8 5 5 5-5" />
                    </svg>
                  </button>
                ) : (
                  <p className="mb-2 px-3.5 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-ink-muted">{group.title.toUpperCase()}</p>
                )}
                {open ? (
                  <ul id={`account-group-${group.id}`} className="space-y-0.5">
                    {group.items.map((item) => {
                      const isScrollLink = scrollSpy && Boolean(item.scrollId);
                      const active = isScrollLink ? activeScrollId === item.scrollId : item.href === activeHref;
                      const itemClassName = `group relative flex h-[38px] w-full items-center rounded-lg px-3.5 text-sm font-medium transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-maroon-700 ${
                        active ? 'bg-maroon-50 font-semibold text-maroon-800' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                      }`;
                      const itemContent = (
                        <>
                          {active && <span className="absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand" aria-hidden="true" />}
                          <span className="truncate">{item.label}</span>
                        </>
                      );
                      return (
                        <li key={item.href}>
                          {isScrollLink ? (
                            <button type="button" aria-current={active ? 'page' : undefined} onClick={() => { scrollTo(item.scrollId); setMenuOpen(false); }} className={itemClassName}>
                              {itemContent}
                            </button>
                          ) : (
                            <Link href={item.href} aria-current={active ? 'page' : undefined} onClick={() => setMenuOpen(false)} className={itemClassName}>
                              {itemContent}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}

          <div>
            <p className="mb-2 px-3.5 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-ink-muted">ACCOUNT ACTIONS</p>
            <ul className="space-y-0.5">
              <li>
                <button
                  ref={signOutButtonRef}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    signOutControl.request();
                  }}
                  disabled={signOutControl.busy}
                  className="flex h-[38px] w-full items-center rounded-lg px-3.5 text-left text-sm font-medium text-red-700 transition-all duration-150 hover:bg-red-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {signOutControl.busy ? 'Signing out…' : 'Sign out'}
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <div className={`min-w-0 flex-1 ${pageClassName ?? ''}`.trim()}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton label={menuOpen ? 'Close account settings menu' : 'Open account settings menu'} className="md:hidden" aria-expanded={menuOpen} aria-controls="account-sidebar" onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </IconButton>
            <Link href="/" className="hidden items-center gap-1.5 rounded-md px-1 py-1 text-sm text-ink-muted hover:text-maroon-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 sm:flex">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12.5 15.5-5-5 5-5" /></svg>
              Back to dashboard
            </Link>
            {breadcrumb ? <Breadcrumb items={breadcrumb} className="min-w-0 text-base text-slate-800" /> : <span className="truncate text-base font-bold text-slate-800">{title}</span>}
          </div>
          <div className="flex items-center gap-2">
            <RowActionMenu
              label={`Account menu for ${user.fullName}`}
              buttonRef={avatarButtonRef}
              triggerClassName="flex items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
              trigger={
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-950 text-sm font-bold text-white" aria-hidden="true">
                    {initials(user.fullName)}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block truncate text-sm font-bold text-slate-900">{user.fullName}</span>
                    <span className="block truncate text-xs text-slate-500">{ROLE_LABELS[user.role]}</span>
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 8 5 5 5-5" />
                  </svg>
                </>
              }
              items={[
                { label: 'My account', href: '/account', active: activeHref === '/account' },
                { label: 'Settings', href: '/settings', active: settingsGroupActive },
                { label: signOutControl.busy ? 'Signing out…' : 'Sign out', disabled: signOutControl.busy, onSelect: signOutControl.request },
              ]}
            />
          </div>
        </header>

        <main className="px-4 py-6 sm:px-8">
          <PageHeader
            title={title}
            description={subtitle}
            eyebrow={eyebrow}
            titleClassName={titleClassName}
            descriptionClassName={subtitleClassName}
            actions={allowed && headerRight ? (typeof headerRight === 'function' ? headerRight(user) : headerRight) : null}
          />
          {allowed ? (
            typeof children === 'function' ? children(user) : children
          ) : (
            <div className="card p-6">
              <p className="text-sm text-slate-700">Your role does not have access to this page.</p>
              <Link className="btn-primary mt-4" href={landingForRole(user.role)}>
                Go to my home
              </Link>
            </div>
          )}
        </main>
      </div>
      <ConfirmDialog {...signOutControl.dialogProps} returnFocusRef={signOutButtonRef} />
      <SessionGuard />
      <Toaster />
      <ResultModal />
    </div>
  );
}
