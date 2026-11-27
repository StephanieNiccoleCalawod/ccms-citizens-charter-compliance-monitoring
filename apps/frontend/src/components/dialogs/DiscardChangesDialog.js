'use client';

import ConfirmDialog from './ConfirmDialog.js';

/** The one "unsaved changes" confirmation, shown when Cancel, X or Escape is used on a dirty modal form. */
export default function DiscardChangesDialog({
  open,
  onConfirm,
  onCancel,
  message = 'What you entered has not been saved. If you close now, it will be lost.',
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Discard changes?"
      message={message}
      confirmLabel="Discard"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
