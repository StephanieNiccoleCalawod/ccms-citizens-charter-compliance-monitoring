'use client';

import { useState } from 'react';

/**
 * Guards closing a dirty modal: requestClose asks to discard first (via DiscardChangesDialog) when
 * dirty, and closes right away otherwise. Wire requestClose to the modal's onClose and to its Cancel
 * button; `close` performs the real close (and should leave the form state reset, as it already does
 * for a non-dirty close).
 */
export function useDiscardGuard(dirty, close) {
  const [askDiscard, setAskDiscard] = useState(false);

  function requestClose() {
    if (dirty) setAskDiscard(true);
    else close();
  }

  function confirmDiscard() {
    setAskDiscard(false);
    close();
  }

  function cancelDiscard() {
    setAskDiscard(false);
  }

  return { askDiscard, requestClose, confirmDiscard, cancelDiscard };
}
