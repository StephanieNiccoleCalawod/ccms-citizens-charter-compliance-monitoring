'use client';

import { useState } from 'react';

// A tiny per-key store backed by a plain module variable (the same pattern AppShell already uses for
// activeSessionUser), so a piece of state outlives its component's mount within this tab. Used where a page
// is left and come back to by ordinary navigation (e.g. the Reports page, before and after the dedicated
// report view) and should show what the user last had instead of a blank form - without reaching for
// sessionStorage for state that only needs to survive this tab's current session, not a reload.
const store = new Map();

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => (store.has(key) ? store.get(key) : initial));
  function set(next) {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      store.set(key, resolved);
      return resolved;
    });
  }
  return [value, set];
}
