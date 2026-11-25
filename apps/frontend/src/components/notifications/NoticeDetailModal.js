'use client';

import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import { KIND_LABEL, kindStyle, noticeDetails, noticePage } from '../../lib/ui/notifications.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  check: <path d="M5 13l4 4L19 7" />,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0" />,
};
const SHOWS_TIME = ['COMPLAINT', 'CALENDAR', 'ACCESS']; // the other notices are worked out at the moment of the request, so a time would mislead

/** What one notice says, opened from "View details" in the bell and in the Notification Center. The notice is already marked read when this opens. */
export default function NoticeDetailModal({ item, onClose, onDelete }) {
  if (!item) return null;
  const look = kindStyle(item.kind);
  const page = noticePage(item);
  const when = SHOWS_TIME.includes(item.kind) && item.at ? formatDateTime(item.at) : null;
  return (
    <Modal open title={look.label} onClose={onClose} hideHeader flushBody widthClass="max-w-xl"
      footer={(
        <>
          {onDelete ? <Button variant="danger" onClick={() => onDelete(item)} data-testid="notice-delete" className="mr-auto">Delete</Button> : null}
          <Button variant="secondary" onClick={onClose} data-testid="notice-close">Close</Button>
          {page ? <Button href={page.href} onClick={onClose} data-testid="notice-open-page">Open {page.label}</Button> : null}
        </>
      )}>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="notice-detail">
        <div className="flex items-start gap-3 border-b border-line bg-slate-50 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border" style={{ backgroundColor: `${look.color}1A`, borderColor: `${look.color}40`, color: look.color }} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{ICONS[look.icon] ?? ICONS.bell}</svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide" style={{ backgroundColor: `${look.color}1A`, color: look.text }}>{KIND_LABEL[item.kind] ?? item.kind}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-slate-600">Read</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{look.label}</h2>
            {when ? <p className="mt-0.5 text-xs text-slate-500">{when}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <div className="p-5">
        <p className="rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-800">{item.text}</p>
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Details</h3>
        <dl className="divide-y divide-line rounded-xl border border-line px-4">
          {noticeDetails(item).map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className={`text-right font-semibold text-slate-900 ${row.mono ? 'font-mono text-xs' : ''}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
        </div>
      </div>
    </Modal>
  );
}
