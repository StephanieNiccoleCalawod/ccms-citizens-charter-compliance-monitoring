'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import { getMe } from '../../lib/api/account.js';
import { clearToken, lastRenewedAt, refreshSession, revokeServerSession, setSessionLimitsOn } from '../../lib/auth/session.js';
import {
  ACTIVITY_EVENTS, ACTIVITY_KEY, ACTIVITY_WRITE_EVERY_MS, IDLE_NOTICE_URL, SESSION_END_KEY, WARNING_COPY,
  countdownText, idleState, readSharedActivity, shouldRenew, writeSharedActivity,
} from '../../lib/auth/idle-guard.js';

/**
 * Signs the person out after their role's idle limit (S8-33). Shows nothing until 60 seconds before that, then a dialog that is
 * announced to screen readers and can be answered by keyboard. Does nothing when the server says limits are off (the default).
 */
export default function SessionGuard() {
  const [policy, setPolicy] = useState(null);
  const [state, setState] = useState({ phase: 'active', secondsLeft: 0 });
  const [busy, setBusy] = useState(false);
  const last = useRef(0); // set to the real time when the guard starts (an effect, not render)
  const lastWrite = useRef(0);
  const ending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        const p = me?.session_policy;
        setSessionLimitsOn(Boolean(p?.enforced));
        if (p?.enforced) setPolicy(p);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const endSession = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    try { window.localStorage.setItem(SESSION_END_KEY, String(Date.now())); } catch { /* blocked */ }
    await revokeServerSession();
    clearToken();
    window.location.assign(IDLE_NOTICE_URL);
  }, []);

  const noteActivity = useCallback(() => {
    if (!policy || ending.current) return;
    const now = Date.now();
    last.current = now;
    if (now - lastWrite.current > ACTIVITY_WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeSharedActivity(window.localStorage, now);
    }
    // The person is working: renew early enough that the server's idle clock never runs out under them.
    if (shouldRenew({ now, renewedAt: lastRenewedAt(), idleMinutes: policy.idle_minutes })) refreshSession(true).catch(() => {});
  }, [policy]);

  useEffect(() => {
    if (!policy) return undefined;
    last.current = Date.now();
    writeSharedActivity(window.localStorage, last.current);
    const options = { passive: true, capture: true };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, noteActivity, options);
    const onStorage = (event) => {
      if (event.key === SESSION_END_KEY && !ending.current) { ending.current = true; window.location.assign(IDLE_NOTICE_URL); }
      if (event.key === ACTIVITY_KEY) last.current = readSharedActivity(window.localStorage, last.current);
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => {
      const next = idleState({ now: Date.now(), lastActivity: readSharedActivity(window.localStorage, last.current), idleMinutes: policy.idle_minutes });
      setState((s) => (s.phase === next.phase && s.secondsLeft === next.secondsLeft ? s : next));
      if (next.phase === 'expired') endSession();
    }, 1000);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, noteActivity, options);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [policy, noteActivity, endSession]);

  const stay = useCallback(async () => {
    setBusy(true);
    const now = Date.now();
    last.current = now;
    writeSharedActivity(window.localStorage, now); // "Stay signed in" counts as activity
    try { await refreshSession(true); } catch { /* the next request will say if Identity is down */ }
    setState({ phase: 'active', secondsLeft: 0 });
    setBusy(false);
  }, []);

  const stayRef = useRef(null);
  if (!policy) return null;
  return (
    <Modal
      open={state.phase === 'warning'}
      title={WARNING_COPY.title}
      role="alertdialog"
      describedBy="session-warning-text"
      initialFocusRef={stayRef}
      widthClass="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={endSession} disabled={busy}>{WARNING_COPY.signOut}</Button>
          <Button ref={stayRef} variant="primary" onClick={stay} loading={busy} loadingLabel="Please wait…">{WARNING_COPY.stay}</Button>
        </>
      }
    >
      <p id="session-warning-text" className="text-sm text-ink-muted">{WARNING_COPY.message}</p>
      <p className="mt-3 text-sm font-semibold text-slate-900" data-testid="session-countdown">
        Signing out in <span aria-hidden="true">{countdownText(state.secondsLeft)}</span>
        <span className="sr-only" role="status">{state.secondsLeft % 15 === 0 || state.secondsLeft <= 10 ? `Signing out in ${countdownText(state.secondsLeft)}` : ''}</span>
      </p>
    </Modal>
  );
}
