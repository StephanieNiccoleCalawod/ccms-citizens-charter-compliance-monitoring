'use client';

import { useState } from 'react';
import { hasChanges } from './dirty-registry.js';

/**
 * For modal forms whose state is null while closed and an object while open: true when the open
 * form differs from the values it opened with. Saving, cancelling or resetting sets the form back to
 * null, which also resets the baseline.
 */
export function useFormDirty(form) {
  const isOpen = form !== null && form !== undefined;
  const [baseline, setBaseline] = useState({ open: false, values: null });
  // Capture the opening values while rendering (React's "adjust state on prop change" pattern).
  if (isOpen !== baseline.open) {
    setBaseline({ open: isOpen, values: isOpen ? form : null });
    return false;
  }
  return isOpen && hasChanges(baseline.values, form);
}
