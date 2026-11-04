'use client';

import { useId, useRef } from 'react';
import Modal from '../modals/Modal.js';

/**
 * Asks before an action. Focus starts on Cancel (the safe choice), so Enter never confirms by
 * accident; Escape and the backdrop cancel unless busy. While busy both buttons are disabled.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  busyLabel = 'Please wait…',
  onConfirm,
  onCancel,
  returnFocusRef,
  children,
}) {
  const messageId = useId();
  const cancelRef = useRef(null);
  return (
    <Modal
      open={open}
      title={title}
      role="alertdialog"
      describedBy={messageId}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      onClose={busy ? undefined : onCancel}
      widthClass="max-w-md"
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <p id={messageId} className="text-sm text-slate-600">
        {message}
      </p>
      {children}
    </Modal>
  );
}
