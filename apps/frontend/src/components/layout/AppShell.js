'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { landingForRole } from 'ccms-shared/nav';
import { activeNavHref, appNavForRole } from '../../lib/auth/permissions.js';
import { ROLES, ROLE_LABELS } from 'ccms-shared/roles';
import { BRAND } from '../../lib/constants/brand.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE, isRoleAllowed } from '../../lib/auth/guards.js';
import { getAccessToken, redirectToLogin, refreshSession, sessionRejection } from '../../lib/auth/session.js';
import { useSignOut } from '../../lib/auth/useSignOut.js';
import Breadcrumb from '../navigation/Breadcrumb.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import Toaster from '../feedback/Toaster.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import BrandMark from '../ui/BrandMark.js';
import NavIcon from './NavIcon.js';
import RowActionMenu from '../ui/RowActionMenu.js';

function initials(name) {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

// Active verified session and sidebar state. Populated only after verification post-hydration.
// On server and during first client hydration, activeSessionUser is null, guaranteeing
// identical initial loading markup and zero hydration mismatch.
let activeSessionUser = null;
let activeSidebarCollapsed = null;

function getInitialState() {
  if (activeSessionUser) {
    return { status: 'ready', user: activeSessionUser, message: null };
  }
  return { status: 'loading', user: null, message: null };
}

function getInitialCollapsed() {
  if (activeSidebarCollapsed !== null) {
    return activeSidebarCollapsed;
  }
  return false;
}

// The permanent sidebar (collapsible to icons) is for screens from the md size up; below that it is a drawer.
const WIDE_QUERY = '(min-width: 768px)';
const readWide = () => (typeof window === 'undefined' ? true : window.matchMedia(WIDE_QUERY).matches);

function persistCollapsed(value) {
  activeSidebarCollapsed = value;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem('ccms_sidebar_collapsed', String(value));
    } catch {
      /* storage blocked or unavailable */
    }
  }
}

/**
 * Layout for every signed-in page: header with the user and Sign out, and navigation that shows
 * only the current role's pages. Pass allowedRoles to keep other roles off a page (the API still
 * enforces access on the server).
 */
export default function AppShell({ title, subtitle, eyebrow, breadcrumb, headerRight, allowedRoles, pageClassName, titleClassName, subtitleClassName, children }) {
  const pathname = usePathname();
  const [state, setState] = useState(getInitialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(getInitialCollapsed);
  const [wide, setWide] = useState(readWide);
  const signOutControl = useSignOut();
  const signOutButtonRef = useRef(null);

  const toggleCollapsed = () => {
    setCollapsedState((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  };

  // Follow the screen size, and let Escape close the drawer.
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      setWide(query.matches);
      if (query.matches) setMenuOpen(false);
    };
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
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
        if (user) {
          activeSessionUser = user;
          if (activeSidebarCollapsed === null && typeof window !== 'undefined') {
            try {
              const stored = window.sessionStorage.getItem('ccms_sidebar_collapsed');
              if (stored !== null) {
                const isCollapsed = stored === 'true';
                activeSidebarCollapsed = isCollapsed;
                setCollapsedState(isCollapsed);
              } else {
                // No saved choice: a tablet starts with icons only, a desktop with the full sidebar.
                const tablet = window.matchMedia('(max-width: 1023px)').matches;
                activeSidebarCollapsed = tablet;
                setCollapsedState(tablet);
              }
            } catch {
              activeSidebarCollapsed = false;
            }
          }
          setState({ status: 'ready', user, message: null });
        } else if (sessionRejection() === ROLE_NOT_RECOGNIZED) {
          activeSessionUser = null;
          setState({ status: 'rejected', user: null, message: ROLE_NOT_RECOGNIZED_MESSAGE });
        } else {
          activeSessionUser = null;
          redirectToLogin();
        }
      })
      .catch((err) => {
        if (!cancelled) {
          activeSessionUser = null;
          setState({ status: 'error', user: null, message: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the session alive quietly and notice a revoked one.
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
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>;
  }
  if (state.status === 'rejected') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <ErrorBanner message={state.message} />
        {/* A full page load on purpose: the sign-in page starts from a clean session. */}
        <a className="btn-primary" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <ErrorBanner message={state.message} />
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { user } = state;
  // The shared nav calls the signed-in landing page "Home"; this app shows it as "Dashboard".
  const nav = appNavForRole(user.role).map((item) => (item.href === '/' && item.label === 'Home' ? { ...item, label: 'Dashboard' } : item));
  const activeHref = activeNavHref(nav, pathname);
  const sections = [...new Set(nav.map((item) => item.section))];
  const allowed = isRoleAllowed(user, allowedRoles);

  // Icons only: the permanent sidebar when collapsed. In the drawer the labels always show.
  const iconOnly = collapsed && wide;
  const drawerHidden = !wide && !menuOpen;
  const toggleLabel = wide ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : menuOpen ? 'Close navigation' : 'Open navigation';

  return (
    <div className="min-h-screen bg-white md:flex">
      {!wide && menuOpen ? <div className="fixed inset-0 z-30 bg-slate-900/40" onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
      {/* Sidebar: a drawer on phones, a permanent sidebar from md up that the hamburger button in the header collapses to icons. */}
      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={`font-sans fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-[#3D0606] text-white transition-[transform,width] duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 md:self-start ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${drawerHidden ? 'invisible md:visible' : ''} ${iconOnly ? 'md:w-[72px]' : 'md:w-64'}`}
      >
        {/* Inner vertical scrolling container */}
        <div className="flex h-full flex-col overflow-y-auto">
          {/* Branding Header */}
          <div
            className={`flex h-16 shrink-0 border-b border-white/10 bg-[#3D0606] transition-all duration-200 ${
              iconOnly
                ? 'items-center justify-center px-2'
                : 'items-center px-4'
            }`}
          >
            <div className={`flex items-center min-w-0 ${iconOnly ? 'justify-center' : 'gap-3'}`}>
              <div className="shrink-0 flex items-center justify-center">
                <BrandMark size={iconOnly ? 34 : 36} />
              </div>
              {!iconOnly && (
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold leading-tight tracking-tight text-white">{BRAND.campus}</p>
                  <p className="truncate text-[10px] font-semibold leading-tight text-[#E5B53A] mt-0.5">{BRAND.system}</p>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className={`space-y-6 py-5 ${iconOnly ? 'px-1.5' : 'px-2.5'}`} aria-label="Main navigation">
            {sections.map((section) => (
              <div key={section}>
                {iconOnly ? (
                  <div className="mb-2 border-t border-white/10 mx-2" aria-hidden="true" />
                ) : (
                  <p className="mb-4 px-3.5 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-[#E5B53A]">
                    {section}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {nav
                    .filter((item) => item.section === section)
                    .map((item) => {
                      const active = item.href === activeHref;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            title={item.label}
                            onClick={() => setMenuOpen(false)}
                            className={`group relative flex h-[38px] items-center rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E5B53A] ${
                              active
                                ? 'bg-[#783535] text-white shadow-sm font-semibold'
                                : 'text-white/80 hover:bg-white/10 hover:text-white'
                            } ${
                              iconOnly
                                ? 'mx-auto w-10 justify-center px-0'
                                : 'w-full px-3.5'
                            }`}
                          >
                            {active && (
                              <span
                                className="absolute left-1 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#E5B53A]"
                                aria-hidden="true"
                              />
                            )}
                            {iconOnly ? (
                              <>
                                <NavIcon href={item.href} />
                                <span className="sr-only">{item.label}</span>
                              </>
                            ) : (
                              <span className="flex min-w-0 items-center gap-4">
                                <NavIcon href={item.href} />
                                <span className="truncate">{item.label}</span>
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${pageClassName ?? ''}`.trim()}>
        <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={wide ? toggleCollapsed : () => setMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
              aria-label={toggleLabel}
              aria-expanded={wide ? !collapsed : menuOpen}
              aria-controls="app-sidebar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {breadcrumb ? <Breadcrumb items={breadcrumb} className="min-w-0 text-base text-slate-800" /> : <span className="truncate text-base font-bold text-slate-800">{title}</span>}
          </div>
          <RowActionMenu
            label={`Account menu for ${user.fullName}`}
            buttonRef={signOutButtonRef}
            triggerClassName="flex items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
            trigger={
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-950 text-sm font-bold text-white" aria-hidden="true">
                  {initials(user.fullName)}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-sm font-bold text-slate-900">{user.fullName}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {ROLE_LABELS[user.role]}
                    {user.role === ROLES.SUPER_ADMIN ? ' · All Offices' : ''}
                  </span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </>
            }
            items={[{ label: signOutControl.busy ? 'Signing out…' : 'Sign out', disabled: signOutControl.busy, onSelect: signOutControl.request }]}
          />
        </header>

        <main className="px-4 py-6 sm:px-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
              <h1 className={titleClassName ?? 'text-3xl'}>{title}</h1>
              {subtitle ? <p className={subtitleClassName ?? 'mt-1 text-sm text-slate-600'}>{subtitle}</p> : null}
            </div>
            {allowed && headerRight ? (typeof headerRight === 'function' ? headerRight(user) : headerRight) : null}
          </div>
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
      <Toaster />
    </div>
  );
}
