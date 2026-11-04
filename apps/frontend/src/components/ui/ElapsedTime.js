'use client';

import { useEffect, useState } from 'react';
import { elapsedState, formatElapsed } from '../../lib/ui/elapsed-time.js';

const NOTES = {
  live: 'Counting up since it started.',
  paused: 'Stopped while pending. Time since it started, up to the moment it was set to pending.',
  final: 'Time from start to finish.',
};

/**
 * The elapsed time of a transaction. Only this small component re-renders each second, and only while the transaction is
 * running; otherwise it renders once and sets no timer. Every tick is computed from the transaction's own started_at and the
 * current time, so a refresh or a second tab shows the same value (on a correct device clock).
 */
export default function ElapsedTime({ transaction }) {
  const [now, setNow] = useState(() => Date.now());
  const live = transaction?.status === 'IN_PROGRESS' && Number.isFinite(Date.parse(transaction.started_at ?? ''));

  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer); // one interval at a time; gone when the page or status changes
  }, [live]);

  const state = elapsedState(transaction, now);
  if (state.kind === 'unavailable') {
    return <span className="text-slate-500" data-testid="elapsed">Not available</span>;
  }
  return (
    <>
      <span role="timer" aria-live="off" className="font-semibold tabular-nums text-slate-900" data-testid="elapsed" data-state={state.kind}>
        {formatElapsed(state.ms)}
      </span>
      <span className="block text-xs text-slate-500">{NOTES[state.kind]}</span>
    </>
  );
}
