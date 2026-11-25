'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNotificationFeeds, markNotificationsRead, deleteNotifications } from '../../lib/api/notifications.js';
import { createPoller } from '../../lib/ui/analytics.js';
import { FEEDS, NOTICE_TABS, chunkKeys, filterNotices, kindStyle, markedAsRead, withoutKeys, mergeNotifications, noticeCounts, unavailableMessage, unreadItems, withLastGood } from '../../lib/ui/notifications.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { confirmDelete } from '../../lib/ui/notice-delete.js';
import NoticeDetailModal from './NoticeDetailModal.js';
import StatCard from '../ui/StatCard.js';
import Button from '../ui/Button.js';
import EmptyState from '../ui/EmptyState.js';

const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  check: <path d="M5 13l4 4L19 7" />,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />,
};
const Icon = ({ name, className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{ICONS[name] ?? ICONS.bell}</svg>
);
const statIcon = (name, color) => <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1A`, color }}><Icon name={name} className="h-4 w-4" /></span>;

/** The full list behind the bell (Settings > Notification Center). Reads the same two feeds and saves read marks the same way. A notice can be deleted (after asking), for this person only. */
export default function NotificationCenter() {
  const [state, setState] = useState({ items: [], failed: [], loaded: false });
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null); // the notice whose details are open
  const poller = useRef(null);
  const lastGood = useRef({});
  const pending = useRef(new Set()); // keys marked read here whose save Oversight has not confirmed yet
  const pendingDeleted = useRef(new Set()); // keys deleted here whose save Oversight has not confirmed yet

  useEffect(() => {
    poller.current = createPoller({
      load: getNotificationFeeds,
      isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      onSuccess: (feeds) => {
        const { feeds: effective, failed, good } = withLastGood(feeds, lastGood.current);
        lastGood.current = good;
        const merged = mergeNotifications(effective, { pendingReadKeys: pending.current, pendingDeletedKeys: pendingDeleted.current });
        if (feeds.oversight?.status === 'fulfilled') for (const key of feeds.oversight.value?.read_keys ?? []) pending.current.delete(key);
        if (feeds.oversight?.status === 'fulfilled') for (const key of feeds.oversight.value?.deleted_keys ?? []) pendingDeleted.current.delete(key);
        setState({ items: merged.items, failed, loaded: true });
      },
      onError: () => setState((s) => ({ ...s, failed: [...FEEDS], loaded: true })),
    });
    poller.current.start();
    return () => poller.current?.stop();
  }, []);

  // Delete: ask first. The notice leaves the list at once; if the server does not confirm, it comes back and the person is told.
  const remove = useCallback((item) => confirmDelete({
    run: async () => {
      pendingDeleted.current.add(item.key);
      setState((s) => ({ ...s, items: withoutKeys(s.items, [item.key]) }));
      try { await deleteNotifications([item.key]); } catch (error) { pendingDeleted.current.delete(item.key); poller.current?.refresh(); throw error; }
    },
  }), []);

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

  const counts = useMemo(() => noticeCounts(state.items), [state.items]);
  const shown = useMemo(() => filterNotices(state.items, tab, query), [state.items, tab, query]);
  const unread = unreadItems(state.items);
  const tabCount = (t) => ` (${state.items.filter(t.pick).length})`;

  return (
    <div className="space-y-5" data-testid="notification-center">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total notices" value={counts.total} icon={statIcon('bell', '#7F1D1D')} testId="nc-total" />
        <StatCard label="Unread" value={counts.unread} tone={counts.unread ? 'brand' : 'default'} icon={statIcon('flag', '#B91C1C')} testId="nc-unread" />
        <StatCard label="Deadlines and late risk" value={counts.deadlines} tone={counts.deadlines ? 'warning' : 'default'} icon={statIcon('clock', '#C2410C')} testId="nc-deadlines" />
        <StatCard label="Complaints and calendar" value={counts.updates} tone="success" icon={statIcon('calendar', '#15803D')} testId="nc-updates" />
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[16rem] flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or message" aria-label="Search notifications" className="input pl-9" data-testid="nc-search" />
        </div>
        <div role="tablist" aria-label="Filter notifications" className="flex flex-wrap gap-1">
          {NOTICE_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${tab === t.id ? 'bg-maroon-800 text-white' : 'text-slate-600 hover:bg-maroon-50'}`}>
              {t.label}{tabCount(t)}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={unread.length === 0} onClick={() => mark(unread.map((i) => i.key))} data-testid="nc-mark-all">Mark all as read</Button>
      </div>

      {state.failed.length > 0 ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{unavailableMessage(state.failed)}</p> : null}

      <section aria-labelledby="nc-list-title" className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id="nc-list-title" className="flex items-center gap-2 text-sm font-bold text-slate-900"><Icon name="bell" className="h-4 w-4 text-maroon-800" />Notices</h2>
          <p className="text-xs text-ink-muted" data-testid="nc-showing">Showing {shown.length} of {state.items.length} notices</p>
        </div>
        {shown.length === 0 ? (
          <div className="p-6">{state.loaded ? <EmptyState role="status" title={state.items.length ? 'No notices match' : 'No notifications'}>{state.items.length ? 'Try another word or filter.' : 'New notices will appear here.'}</EmptyState> : <p className="text-sm text-slate-600">Loading…</p>}</div>
        ) : (
          <ul className="space-y-3 p-4">
            {shown.map((item) => {
              const look = kindStyle(item.kind);
              const when = item.kind === 'COMPLAINT' || item.kind === 'CALENDAR' ? formatDateTime(item.at) : null;
              return (
                <li key={item.key} className="relative">
                  <button type="button" onClick={() => { mark([item.key]); setDetail(item); }} data-testid="nc-item"
                    className={`flex w-full items-start gap-4 rounded-xl text-left border p-4 hover:border-maroon-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${item.read ? 'border-line bg-white' : 'border-maroon-100 bg-maroon-50/60'}`}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ backgroundColor: `${look.color}1A`, borderColor: `${look.color}40`, color: look.color }} aria-hidden="true"><Icon name={look.icon} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-slate-900 ${item.read ? 'font-semibold' : 'font-bold'}`}>{look.label}</span>
                        {item.read ? null : <span className="rounded-full bg-maroon-700 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">New</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">{item.text}</span>
                      {when ? <span className="mt-1.5 block text-xs text-slate-400">{when}</span> : null}
                    </span>
                    <span className="shrink-0 self-center pr-9 text-xs font-semibold" style={{ color: look.text }}>View details →</span>
                  </button>
                  <button type="button" onClick={() => remove(item)} aria-label={`Delete notification: ${look.label}`} title="Delete" data-testid="nc-delete"
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <NoticeDetailModal item={detail} onClose={() => setDetail(null)} onDelete={(item) => { setDetail(null); remove(item); }} />
    </div>
  );
}
