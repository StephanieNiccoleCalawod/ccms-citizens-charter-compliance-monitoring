'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getNotificationFeeds, markNotificationsRead } from '../../lib/api/notifications.js';
import { createPoller } from '../../lib/ui/analytics.js';
import { FEEDS, badgeText, chunkKeys, kindStyle, markedAsRead, mergeNotifications, unavailableMessage, unreadItems, withLastGood } from '../../lib/ui/notifications.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import IconButton from '../ui/IconButton.js';

const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  check: <path d="M5 13l4 4L19 7" />,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />,
};

// Notification bell (CC055): the count of unread notices and a list. Worked out by the services on each request and refreshed every
// 60 seconds while the page is visible. No emails. A notice is marked read when it is opened, or all at once.
export default function NotificationBell() {
  const [state, setState] = useState({ items: [], failed: [], partial: false, loaded: false });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const poller = useRef(null);
  const button = useRef(null);
  const lastGood = useRef({}); // last good answer of each feed, kept while that feed is down
  const pending = useRef(new Set()); // keys marked read here whose save Oversight has not confirmed yet

  useEffect(() => {
    poller.current = createPoller({
      load: getNotificationFeeds,
      isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      onSuccess: (feeds) => {
        const { feeds: effective, failed, good } = withLastGood(feeds, lastGood.current);
        lastGood.current = good;
        const merged = mergeNotifications(effective, { pendingReadKeys: pending.current });
        if (feeds.oversight?.status === 'fulfilled') for (const key of feeds.oversight.value?.read_keys ?? []) pending.current.delete(key);
        setState({ items: merged.items, failed, partial: failed.length > 0, loaded: true });
      },
      onError: () => setState((s) => ({ ...s, failed: [...FEEDS], partial: true, loaded: true })),
    });
    poller.current.start();
    const onVisible = () => { if (document.visibilityState === 'visible') poller.current?.resumeIfStale(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); poller.current?.stop(); };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const unread = useMemo(() => unreadItems(state.items), [state.items]);
  const mark = useCallback(async (keys) => {
    if (keys.length === 0) return;
    keys.forEach((key) => pending.current.add(key));
    setState((s) => ({ ...s, items: markedAsRead(s.items, keys) }));
    try {
      for (const batch of chunkKeys(keys)) await markNotificationsRead(batch);
    } catch {
      keys.forEach((key) => pending.current.delete(key));
      poller.current?.refresh();
    }
  }, []);

  return (
    <div className="relative" ref={box} data-testid="notification-bell">
      <IconButton ref={button} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? 'notification-panel' : undefined}
        label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications, none unread'}
        className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread.length ? <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-maroon-700 px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white" data-testid="bell-count">{badgeText(unread.length)}</span> : null}
      </IconButton>
      {open ? (
        <div id="notification-panel" role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg" data-testid="bell-panel">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-bold text-slate-900">Notifications</p>
            <button type="button" className="text-xs font-semibold text-maroon-800 underline disabled:text-slate-400 disabled:no-underline" disabled={unread.length === 0} onClick={() => mark(unread.map((i) => i.key))} data-testid="bell-mark-all">Mark all as read</button>
          </div>
          {state.partial ? <p role="status" className="border-b border-slate-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{unavailableMessage(state.failed)}</p> : null}
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto p-2">
            {state.items.length === 0 ? <li className="px-3 py-4 text-sm text-slate-600">{state.loaded ? 'No notifications.' : 'Loading…'}</li> : state.items.map((item) => {
              const look = kindStyle(item.kind);
              return (
                <li key={item.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" style={{ borderLeft: `4px solid ${look.color}` }}>
                  <Link href={item.href || '/'} onClick={() => { mark([item.key]); setOpen(false); }} className={`flex gap-3 px-3 py-2 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-700 ${item.read ? '' : 'bg-slate-50'}`}>
                    <span className="mt-0.5 shrink-0" style={{ color: look.color }} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{ICONS[look.icon] ?? ICONS.bell}</svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold" style={{ backgroundColor: `${look.color}1A`, color: look.text }}>{look.label}</span>
                        <span className="text-xs text-slate-500">
                          {item.kind === 'COMPLAINT' || item.kind === 'CALENDAR' ? formatDateTime(item.at) : null}
                          {item.read ? null : <span className="ml-2 font-bold text-maroon-800">New</span>}
                        </span>
                      </span>
                      <span className={`mt-1 block text-slate-800 ${item.read ? '' : 'font-semibold'}`}>{item.text}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
