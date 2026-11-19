'use client';

import { useEffect, useRef, useState } from 'react';
import { INITIAL_ANALYTICS_STATE, POLL_INTERVAL_MS, createPoller, failed, loaded, refreshStarted } from './analytics.js';

/**
 * Polls an analytics loader once immediately, then every 60 seconds while the tab is visible.
 * Preserves the last good data on background refresh failures and catches up when returning to a stale tab.
 */
export function useAnalytics({ enabled = true, load, deps = [], intervalMs = POLL_INTERVAL_MS } = {}) {
  const [state, setState] = useState(INITIAL_ANALYTICS_STATE);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled || typeof loadRef.current !== 'function') return undefined;
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        setState((s) => ({
          ...s,
          status: s.data ? 'ready' : 'loading',
          refreshing: Boolean(s.data),
          error: null,
        }));
      }
    });
    const poller = createPoller({
      load: () => loadRef.current(),
      intervalMs,
      isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      onStart: (initial) => {
        if (active && !initial) setState((s) => refreshStarted(s, initial));
      },
      onSuccess: (data) => {
        if (active) setState((s) => loaded(s, data, new Date().toISOString()));
      },
      onError: (error, initial) => {
        if (active) setState((s) => failed(s, error, initial));
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') poller.resumeIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);
    poller.start();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      poller.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, ...deps]);

  return [state, setState];
}
