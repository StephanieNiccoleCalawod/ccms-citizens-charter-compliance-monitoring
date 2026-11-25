// S8-33 (FE): the inactivity warning, as plain functions so the rules can be tested without a browser.
// Only the person's own actions count as activity (mouse, keyboard, touch, scroll). Background polling never does.
// The limits come from GET /me `session_policy` (the Super Admin sees all of them in Settings > Security and sessions).

export const WARNING_SECONDS = 60;
export const ACTIVITY_KEY = 'ccms_last_activity'; // shared by every tab of this browser, so the tabs agree
export const SESSION_END_KEY = 'ccms_session_end';
export const ACTIVITY_WRITE_EVERY_MS = 5_000;
export const IDLE_NOTICE_URL = '/login?notice=session_idle';
export const ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']);

/** { phase: 'active' | 'warning' | 'expired', secondsLeft } for the idle clock at `now`. */
export function idleState({ now, lastActivity, idleMinutes, warningSeconds = WARNING_SECONDS }) {
  const secondsLeft = Math.ceil((lastActivity + idleMinutes * 60_000 - now) / 1000);
  if (secondsLeft <= 0) return { phase: 'expired', secondsLeft: 0 };
  if (secondsLeft <= warningSeconds) return { phase: 'warning', secondsLeft };
  return { phase: 'active', secondsLeft };
}

/** Whether to ask Identity for a new access token on this activity: only when the last renewal is older than a third of the idle limit. */
export function shouldRenew({ now, renewedAt, idleMinutes }) {
  return now - renewedAt > (idleMinutes * 60_000) / 3;
}

/** The warning's words: how long is left, in whole seconds. */
export function countdownText(secondsLeft) {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${s} ${s === 1 ? 'second' : 'seconds'}`;
}

export const WARNING_COPY = Object.freeze({
  title: 'Still there?',
  message: 'You will be signed out soon because there has been no activity. Choose Stay signed in to keep working.',
  stay: 'Stay signed in',
  signOut: 'Sign out',
});

/** The latest activity time saved by any tab (or `fallback`). */
export function readSharedActivity(storage, fallback) {
  try {
    const value = Number(storage?.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? Math.max(value, fallback ?? 0) : fallback;
  } catch {
    return fallback;
  }
}

/** Saves the activity time for the other tabs. Never throws (storage may be blocked). */
export function writeSharedActivity(storage, time) {
  try {
    storage?.setItem(ACTIVITY_KEY, String(time));
  } catch {
    /* blocked: this tab still works on its own clock */
  }
}
