// Sign-out as plain functions with injected dependencies (no React, no browser globals), so the rules
// can be tested on their own:
//   - cancelling never revokes the session;
//   - confirming revokes once, and further confirmations are ignored while it runs;
//   - the saved token is always cleared, even when Identity cannot confirm the revocation;
//   - when Identity does not confirm, the sign-in page finishes the job (?signed_out=1) and the
//     notice travels in the URL, so it survives the full-page redirect;
//   - nothing here throws or rejects, and no token or credential is ever logged.

export const SIGN_OUT_COPY = Object.freeze({
  title: 'Sign out?',
  message: 'You will need to sign in again to use CCMS.',
  dirtyMessage: 'You have unsaved changes. Sign out anyway?',
  confirmLabel: 'Sign out',
});

/** Notices the sign-in page may show. Anything else in ?notice= is ignored, never rendered. */
export const LOGIN_NOTICES = Object.freeze({
  revoke_failed:
    'The server could not confirm that your session was ended. Your saved sign-in was removed from this page, but the session may still be active on the server. Choose "Try again" when the connection is back, or close the browser if this is a shared computer.',
});

export const SIGNED_OUT_URL = '/login';
export const REVOKE_FALLBACK_URL = '/login?signed_out=1&notice=revoke_failed';

/** The whitelisted notice code from a query string, or null. */
export function parseLoginNotice(search) {
  const code = new URLSearchParams(search ?? '').get('notice');
  return code && Object.hasOwn(LOGIN_NOTICES, code) ? code : null;
}

/**
 * What the sign-in page shows after ?signed_out=1 and its own revocation retry: a notice only when
 * that retry could not confirm the revocation either (an older ?signed_out=1 link without &notice=
 * gets the same, honest notice). requested must come from parseLoginNotice.
 */
export function noticeAfterRetry({ requested = null, retryRevoked }) {
  if (retryRevoked) return null;
  return requested ?? 'revoke_failed';
}

/**
 * Revokes the server session, clears the local token and navigates. Never rejects; resolves to
 * { revoked, destination, error }.
 */
export async function performSignOut({ revoke, clearToken, navigate, notify = () => {} }) {
  let revoked = false;
  try {
    revoked = (await revoke()) === true;
  } catch {
    revoked = false;
  }
  // Clear the local token whatever Identity answered: this browser must not stay signed in.
  try {
    clearToken();
  } catch {
    /* storage blocked: the token is still dropped from memory by the next page load */
  }
  const destination = revoked ? SIGNED_OUT_URL : REVOKE_FALLBACK_URL;
  if (!revoked) safely(notify, { type: 'revoke_failed' });
  try {
    navigate(destination);
    return { revoked, destination, error: null };
  } catch (error) {
    safely(notify, { type: 'navigate_failed' });
    return { revoked, destination, error };
  }
}

function safely(fn, arg) {
  try {
    fn(arg);
  } catch {
    /* a notifier must never break sign-out */
  }
}

/**
 * The confirmation state machine. execute() performs the sign-out (normally session.signOut);
 * isDirty() says whether a form has unsaved changes; onChange(state) is called on every change.
 */
export function createSignOutFlow({ execute, isDirty = () => false, onChange = () => {} }) {
  let state = { open: false, busy: false, dirty: false };
  let running = null;

  const set = (next) => {
    state = { ...state, ...next };
    safely(onChange, state);
  };

  return {
    getState: () => state,
    message: () => (state.dirty ? SIGN_OUT_COPY.dirtyMessage : SIGN_OUT_COPY.message),

    /** Opens the confirmation (re-checking unsaved changes). Ignored while signing out. */
    request() {
      if (state.busy) return state;
      let dirty = false;
      try {
        dirty = Boolean(isDirty());
      } catch {
        dirty = false;
      }
      set({ open: true, dirty });
      return state;
    },

    /** Closes the confirmation without touching the session. Refused while signing out. */
    cancel() {
      if (state.busy) return false;
      set({ open: false, dirty: false });
      return true;
    },

    /** Signs out once. Repeated calls while busy return the same promise. Never rejects. */
    confirm() {
      if (running) return running;
      if (!state.open) return Promise.resolve(null);
      set({ busy: true });
      running = Promise.resolve()
        .then(() => execute())
        .catch((error) => ({ revoked: false, destination: null, error }))
        .then((result) => {
          // A successful sign-out navigates away; only a failed navigation lands back here.
          if (result?.error) {
            running = null;
            set({ busy: false });
          }
          return result ?? null;
        });
      return running;
    },
  };
}
