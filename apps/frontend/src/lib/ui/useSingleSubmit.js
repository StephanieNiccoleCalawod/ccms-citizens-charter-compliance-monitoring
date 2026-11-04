'use client';

import { useRef } from 'react';

/**
 * Guards a save against a second submit while the first is still running (a double click, or Enter pressed twice).
 * `run(task)` starts the task and ignores further calls until it settles; the disabled button alone is not enough
 * because a form can also be submitted from the keyboard before React has re-rendered.
 */
export function useSingleSubmit() {
  const busy = useRef(false);
  return async function run(task) {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await task();
    } finally {
      busy.current = false;
    }
  };
}
