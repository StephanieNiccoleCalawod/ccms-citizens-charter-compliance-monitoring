'use client';

import { useSyncExternalStore } from 'react';
import { dismiss, getServerToasts, getToasts, subscribe } from '../../lib/ui/notify.js';

const STYLES = {
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: 'text-emerald-600', role: 'status', live: 'polite' },
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: 'text-red-600', role: 'alert', live: 'assertive' },
};

function CheckCircle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="m6.5 10.2 2.4 2.4 4.6-5" />
    </svg>
  );
}

function AlertCircle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v4.5M10 13.6v.1" />
    </svg>
  );
}

/**
 * The only place a save notification is drawn (rendered once, by the app shell): top right, above modals. Green with a check for
 * success, red with an alert icon for an error; each can be dismissed and goes away by itself (the store sets the time).
 */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getServerToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" data-testid="toaster">
      {toasts.map((toast) => {
        const style = STYLES[toast.kind] ?? STYLES.success;
        return (
          <div
            key={toast.id}
            role={style.role}
            aria-live={style.live}
            data-kind={toast.kind}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${style.box}`}
          >
            <span className={style.icon}>{toast.kind === 'error' ? <AlertCircle /> : <CheckCircle />}</span>
            <p className="min-w-0 flex-1 break-words font-medium">{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="-mr-1 -mt-0.5 rounded p-1 text-current opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
