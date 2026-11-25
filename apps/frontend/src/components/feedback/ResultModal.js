'use client';

import { useRef, useSyncExternalStore } from 'react';
import { dismissResult, getResult, getServerResult, subscribe } from '../../lib/ui/notify.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';

const TONE = {
  success: { icon: 'text-emerald-600', ring: 'bg-emerald-50 ring-emerald-100', label: 'Success' },
  warning: { icon: 'text-amber-600', ring: 'bg-amber-50 ring-amber-100', label: 'Warning' },
  error: { icon: 'text-red-600', ring: 'bg-red-50 ring-red-100', label: 'Failed' },
  confirm: { icon: 'text-maroon-700', ring: 'bg-maroon-50 ring-maroon-100', label: 'Confirm' },
};
const DANGER = { icon: 'text-red-600', ring: 'bg-red-50 ring-red-100' };

function Icon({ variant, danger }) {
  const path = variant === 'success' ? 'm6.5 10.2 2.4 2.4 4.6-5' : variant === 'confirm' ? 'M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M10 13.6v.1' : 'M10 6v4.5M10 13.6v.1';
  const tone = danger ? DANGER : TONE[variant];
  return (
    <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ring-8 ${tone?.ring ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 20 20" className={`h-9 w-9 ${tone?.icon ?? ''}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="8" />
        <path d={path} />
      </svg>
    </span>
  );
}

/**
 * The one result dialog (drawn once by the app shell). Success, Warning and Failed have one OK button; Confirm has Cancel and the
 * confirm button (red when the action deletes something). Focus starts on the safe button, Esc and the backdrop close it, and it is
 * announced as an alert dialog. The icon, title, message and buttons are centred in one block.
 */
export default function ResultModal() {
  const result = useSyncExternalStore(subscribe, getResult, getServerResult);
  const okRef = useRef(null);
  if (!result) return null;
  const isConfirm = result.variant === 'confirm';
  function confirm() {
    const action = result.onConfirm;
    dismissResult();
    action?.();
  }
  return (
    <Modal key={result.id} open title={result.title} role="alertdialog" initialFocusRef={okRef} onClose={dismissResult} widthClass="max-w-sm" hideHeader flushBody>
      <div className="px-7 pb-6 pt-8 text-center" data-testid="result-modal" data-variant={result.variant}>
        <Icon variant={result.variant} danger={result.danger} />
        <p className="mt-5 text-lg font-bold text-slate-900" aria-hidden="true">{result.title}</p>
        <p className="mt-1.5 break-words text-sm leading-relaxed text-ink-muted">
          <span className="sr-only">{TONE[result.variant].label}: </span>
          {result.message}
        </p>
        <div className="mt-7 flex justify-center gap-3">
          {isConfirm ? (
            <>
              <Button ref={okRef} variant="secondary" onClick={dismissResult} className="min-w-[7rem]">{result.cancelLabel}</Button>
              <Button variant={result.danger ? 'danger' : 'primary'} onClick={confirm} className="min-w-[7rem]">{result.confirmLabel}</Button>
            </>
          ) : (
            <Button ref={okRef} variant="primary" onClick={dismissResult} className="min-w-[7rem]">{result.confirmLabel}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
