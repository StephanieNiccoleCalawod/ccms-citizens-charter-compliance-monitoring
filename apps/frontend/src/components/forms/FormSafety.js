'use client';

import { useEffect } from 'react';
import { isAnyDirty } from '../../lib/ui/dirty-registry.js';
import { installFocusFirstError } from '../../lib/ui/focus-first-error.js';

/**
 * Two things every form screen gets, mounted once in the root layout (S8-37). It renders nothing.
 *   - after a submit with a problem, the focus goes to the first field to fix (see focus-first-error.js);
 *   - closing the tab, reloading or leaving the site with unsaved work in an open form asks first, using the same "does this form have
 *     unsaved changes?" registry that Sign out already uses. The browser shows its own wording; nothing is stored.
 */
export default function FormSafety() {
  useEffect(() => {
    const stopFocusing = installFocusFirstError(document);
    const onBeforeUnload = (event) => {
      if (!isAnyDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stopFocusing();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
  return null;
}
