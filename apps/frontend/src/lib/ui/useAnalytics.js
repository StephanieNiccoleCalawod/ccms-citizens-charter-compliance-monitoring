'use client';

import { useEffect, useState } from 'react';
import { loadAnalytics } from '../api/analytics.js';
import { INITIAL_ANALYTICS_STATE, POLL_INTERVAL_MS, createPoller, failed, loaded, refreshStarted } from './analytics.js';

/**
 * The Insights data: loaded once, then refreshed every 60 seconds. A refresh never clears what is already shown; if it fails the
 * last good data stays and `refreshError` says so. Nothing runs while the page is hidden, and a hidden page catches up when it
 * comes back. `scope` and `load` must be stable (memoized) so a re-render does not restart the timer.
 */
export function useAnalytics(scope, { load = loadAnalytics, intervalMs = POLL_INTERVAL_MS } = {}) {
  const [state, setState] = useState(INITIAL_ANALYTICS_STATE);

  useEffect(() => {
    if (!scope?.ok) return undefined;
    const poller = createPoller({
      load: () => load(scope),
      intervalMs,
      isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      onStart: (initial) => !initial && setState((s) => refreshStarted(s, initial)),
      onSuccess: (data) => setState((s) => loaded(s, data, new Date().toISOString())),
      onError: (error, initial) => setState((s) => failed(s, error, initial)),
    });
    const onVisible = () => document.visibilityState === 'visible' && poller.resumeIfStale();
    document.addEventListener('visibilitychange', onVisible);
    poller.start();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      poller.stop();
    };
  }, [scope, load, intervalMs]);

  return state;
}
