'use client';

import { useState } from 'react';
import Link from 'next/link';
import { kindStyle, unavailableMessage } from '../../lib/ui/notifications.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  check: <path d="M5 13l4 4L19 7" />,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />,
};

// The tabs only filter what is already loaded; nothing is fetched or saved from here.
const DEADLINE_KINDS = ['OVERDUE', 'DEADLINE', 'HIGH_RISK'];
const TABS = [
  { id: 'all', label: 'All', pick: () => true },
  { id: 'unread', label: 'Unread', pick: (i) => !i.read },
  { id: 'deadlines', label: 'Deadlines', pick: (i) => DEADLINE_KINDS.includes(i.kind) },
  { id: 'updates', label: 'Updates', pick: (i) => !DEADLINE_KINDS.includes(i.kind) },
];
const EMPTY = { unread: 'No unread notifications.' };

/** The panel of the notification bell (CC055): header, filter tabs and one row per notice. Presentation only; the bell owns the data. */
export default function NotificationPanel({ items, unreadCount, loaded, partial, failed, onMarkAll, onOpenItem }) {
  const [tab, setTab] = useState('all');
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const shown = items.filter(active.pick);

  return (
    <div id="notification-panel" role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[26rem] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white font-sans shadow-xl" data-testid="bell-panel">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-maroon-800 text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{ICONS.bell}</svg>
          </span>
          <p className="text-base font-bold text-slate-900">Notifications</p>
          {unreadCount > 0 ? <span className="rounded-full bg-maroon-700 px-2 py-0.5 text-[0.7rem] font-bold text-white">{unreadCount} new</span> : null}
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-maroon-800 hover:underline disabled:text-slate-400 disabled:no-underline" disabled={unreadCount === 0} onClick={onMarkAll} data-testid="bell-mark-all">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">{ICONS.check}</svg>
          Mark all as read
        </button>
      </div>
      <div role="tablist" aria-label="Filter notifications" className="flex flex-wrap gap-1 border-b border-slate-100 px-3 pb-2">
        {TABS.map((t) => {
          const count = t.id === 'all' || t.id === 'unread' ? ` (${items.filter(t.pick).length})` : '';
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${tab === t.id ? 'bg-maroon-800 text-white' : 'text-slate-600 hover:bg-maroon-50'}`}>
              {t.label}{count}
            </button>
          );
        })}
      </div>
      {partial ? <p role="status" className="border-b border-slate-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">{unavailableMessage(failed)}</p> : null}
      <ul className="max-h-[28rem] overflow-y-auto">
        {shown.length === 0 ? <li className="px-4 py-6 text-sm text-slate-600">{loaded ? EMPTY[tab] ?? 'No notifications.' : 'Loading…'}</li> : shown.map((item) => {
          const look = kindStyle(item.kind);
          const when = item.kind === 'COMPLAINT' || item.kind === 'CALENDAR' ? formatDateTime(item.at) : null;
          return (
            <li key={item.key} className="relative border-b border-slate-100 last:border-b-0">
              {item.read ? null : <span className="absolute left-1.5 top-5 h-2 w-2 rounded-full bg-maroon-700" aria-hidden="true" />}
              <Link href={item.href || '/'} onClick={() => onOpenItem(item.key)} className={`flex gap-3 py-3 pl-5 pr-4 text-sm hover:bg-maroon-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-700 ${item.read ? '' : 'bg-maroon-50/60'}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ backgroundColor: `${look.color}1A`, borderColor: `${look.color}40`, color: look.color }} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{ICONS[look.icon] ?? ICONS.bell}</svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-slate-900 ${item.read ? 'font-semibold' : 'font-bold'}`}>{item.read ? null : <span className="sr-only">New: </span>}{look.label}</span>
                  <span className="mt-0.5 block text-slate-600">{item.text}</span>
                  <span className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400">{when}</span>
                    <span className="font-semibold" style={{ color: look.text }}>View details →</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
