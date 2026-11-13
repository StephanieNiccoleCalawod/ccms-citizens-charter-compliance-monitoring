'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getNotificationFeeds, markNotificationsRead } from '../../lib/api/notifications.js';
import { createPoller } from '../../lib/ui/analytics.js';
import { KIND_LABEL, badgeText, markedAsRead, mergeNotifications, unreadItems } from '../../lib/ui/notifications.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import IconButton from '../ui/IconButton.js';

// Notification bell (CC055): the count of unread notices and a list. Worked out by the services on each request and refreshed every
// 60 seconds while the page is visible. No emails. A notice is marked read when it is opened, or all at once.
export default function NotificationBell() {
  const [state, setState] = useState({ items: [], partial: false, loaded: false });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const poller = useRef(null);

  useEffect(() => {
    poller.current = createPoller({
      load: getNotificationFeeds,
      isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      onSuccess: (feeds) => setState({ ...mergeNotifications(feeds), loaded: true }),
      onError: () => setState((s) => ({ ...s, partial: true, loaded: true })),
    });
    poller.current.start();
    const onVisible = () => { if (document.visibilityState === 'visible') poller.current?.resumeIfStale(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); poller.current?.stop(); };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const unread = useMemo(() => unreadItems(state.items), [state.items]);
  const mark = useCallback(async (keys) => {
    if (keys.length === 0) return;
    setState((s) => ({ ...s, items: markedAsRead(s.items, keys) }));
    try { await markNotificationsRead(keys.slice(0, 200)); } catch { poller.current?.refresh(); }
  }, []);

  return (
    <div className="relative" ref={box} data-testid="notification-bell">
      <IconButton onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications, none unread'}
        className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread.length ? <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-maroon-700 px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white" data-testid="bell-count">{badgeText(unread.length)}</span> : null}
      </IconButton>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg" data-testid="bell-panel">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-bold text-slate-900">Notifications</p>
            <button type="button" className="text-xs font-semibold text-maroon-800 underline disabled:text-slate-400 disabled:no-underline" disabled={unread.length === 0} onClick={() => mark(unread.map((i) => i.key))} data-testid="bell-mark-all">Mark all as read</button>
          </div>
          {state.partial ? <p className="border-b border-slate-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">Some notices could not be loaded right now.</p> : null}
          <ul className="max-h-96 overflow-y-auto">
            {state.items.length === 0 ? <li className="px-3 py-4 text-sm text-slate-600">{state.loaded ? 'No notifications.' : 'Loading…'}</li> : state.items.map((item) => (
              <li key={item.key} className={`border-b border-slate-100 last:border-0 ${item.read ? '' : 'bg-maroon-50/40'}`}>
                <Link href={item.href || '/'} onClick={() => { mark([item.key]); setOpen(false); }} className="block px-3 py-2 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-700">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{KIND_LABEL[item.kind] ?? item.kind}{item.read ? '' : ' · new'}</span>
                  <span className="block text-slate-800">{item.text}</span>
                  {item.kind === 'COMPLAINT' || item.kind === 'CALENDAR' ? <span className="block text-xs text-slate-500">{formatDateTime(item.at)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
