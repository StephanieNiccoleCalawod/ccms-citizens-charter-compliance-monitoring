'use client';

import { useRef, useSyncExternalStore } from 'react';
import { dismissResult, getResult, getServerResult, subscribe } from '../../lib/ui/notify.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';

const TONE = {
  success: { icon: 'text-emerald-600', label: 'Success' },
  warning: { icon: 'text-amber-600', label: 'Warning' },
  error: { icon: 'text-red-600', label: 'Failed' },
  confirm: { icon: 'text-maroon-700', label: 'Confirm' },
};

function Icon({ variant }) {
  const path = variant === 'success' ? 'm6.5 10.2 2.4 2.4 4.6-5' : variant === 'confirm' ? 'M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M10 13.6v.1' : 'M10 6v4.5M10 13.6v.1';
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-6 w-6 shrink-0 ${TONE[variant]?.icon ?? ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d={path} />
    </svg>
  );
}

/**
 * The one result dialog (drawn once by the app shell). Success, Warning and Failed have one OK button; Confirm has Cancel and the
 * confirm button. Focus starts on the safe button, Esc and the backdrop close it, and it is announced as an alert dialog.
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
    <Modal
      key={result.id}
      open
      title={result.title}
      role="alertdialog"
      initialFocusRef={okRef}
      onClose={dismissResult}
      widthClass="max-w-md"
      footer={isConfirm ? (
        <>
          <Button ref={okRef} variant="secondary" onClick={dismissResult}>{result.cancelLabel}</Button>
          <Button variant="primary" onClick={confirm}>{result.confirmLabel}</Button>
        </>
      ) : (
        <Button ref={okRef} variant="primary" onClick={dismissResult}>{result.confirmLabel}</Button>
      )}
    >
      <div className="flex items-start gap-3" data-testid="result-modal" data-variant={result.variant}>
        <Icon variant={result.variant} />
        <p className="min-w-0 flex-1 break-words text-sm text-ink-muted">
          <span className="sr-only">{TONE[result.variant].label}: </span>
          {result.message}
        </p>
      </div>
    </Modal>
  );
}
