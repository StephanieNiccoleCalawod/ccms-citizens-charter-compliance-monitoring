'use client';

import { useId, useRef } from 'react';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';

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
  confirmClassName,
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
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={confirmClassName ? null : danger ? 'danger' : 'primary'}
            className={confirmClassName}
            onClick={onConfirm}
            loading={busy}
            loadingLabel={busyLabel}
          >
            {confirmLabel}
          </Button>
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
