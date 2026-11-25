'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNotificationFeeds, markNotificationsRead } from '../../lib/api/notifications.js';
import { createPoller } from '../../lib/ui/analytics.js';
import { FEEDS, badgeText, chunkKeys, markedAsRead, mergeNotifications, unreadItems, withLastGood } from '../../lib/ui/notifications.js';
import IconButton from '../ui/IconButton.js';
import NotificationPanel from './NotificationPanel.js';

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
        <NotificationPanel items={state.items} unreadCount={unread.length} loaded={state.loaded} partial={state.partial} failed={state.failed}
          onMarkAll={() => mark(unread.map((i) => i.key))} onOpenItem={(key) => { mark([key]); setOpen(false); }} onNavigate={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
