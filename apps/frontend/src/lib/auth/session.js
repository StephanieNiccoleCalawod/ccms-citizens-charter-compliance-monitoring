// Browser-side session handling. The refresh token is an httpOnly cookie set by the Identity
// service. The short-lived access token is kept in memory and mirrored to sessionStorage (this tab
// only) so it survives page loads: a page opened while the token is still valid does not need the
// Identity service at all, which is what keeps the other services usable if Identity is briefly
// down (RBAC doc 3.5). When the token is close to expiry the session is refreshed. If Identity
// cannot be reached the user sees a clear message instead of being sent to a sign-in page that
// would not load either; an expired or revoked refresh token (401) still returns to sign-in.


import { IDENTITY_API } from '../api/identity.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE, userFromClaims } from './guards.js';
import { performSignOut } from './sign-out-flow.js';
const REFRESH_MARGIN_MS = 30_000;

const STORAGE_KEY = 'ccms_access';

// A marker cookie that says "someone is signed in on this browser". Unlike sessionStorage, cookies are
// shared by every CCMS app on the same host even when each runs on its own port, so signing out in one
// app is noticed by the others: they drop their saved token instead of staying signed in.
const MARKER = 'ccms_signed_in';
const hasMarker = () => typeof document === 'undefined' || document.cookie.split('; ').some((c) => c.startsWith(`${MARKER}=`));
function setMarker(on) {
  if (typeof document === 'undefined') return;
  document.cookie = on ? `${MARKER}=1; path=/; SameSite=Strict` : `${MARKER}=; path=/; max-age=0; SameSite=Strict`;
}

/** True when this browser may hold a session (the shared marker cookie). Cheap: makes no network call. */
export function mightBeSignedIn() {
  return typeof document !== 'undefined' && hasMarker();
}

let accessToken = null;
let expiresAt = 0;
let refreshing = null;
let hydrated = false;
let rejection = null;

/** Why the last token was refused (ROLE_NOT_RECOGNIZED), or null. Lets screens explain a sign-out. */
export function sessionRejection() {
  return rejection;
}

/** Loads a still-valid access token saved by an earlier page of this tab. */
function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    const usable = saved?.token && saved.expiresAt > Date.now() && hasMarker();
    const claims = usable ? decodeClaims(saved.token) : null;
    if (usable && userFromClaims(claims)) {
      accessToken = saved.token;
      expiresAt = saved.expiresAt;
    } else {
      // Only a still-valid token refused for its role is a rejection; an expired one is not.
      if (claims) rejection = ROLE_NOT_RECOGNIZED;
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage blocked or corrupt: fall back to refreshing */
  }
}

function persist() {
  try {
    if (accessToken) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: accessToken, expiresAt }));
    else window.sessionStorage.removeItem(STORAGE_KEY);
    setMarker(Boolean(accessToken));
  } catch {
    /* storage blocked: the token still works from memory */
  }
}

export function clearToken() {
  accessToken = null;
  expiresAt = 0;
  persist();
}

const tokenIsFresh = () => Boolean(accessToken) && Date.now() < expiresAt - REFRESH_MARGIN_MS;
const tokenIsValid = () => Boolean(accessToken) && Date.now() < expiresAt;

export class ApiError extends Error {
  constructor(message, { code, status, details, correlationId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.correlationId = correlationId;
  }
}

function decodeClaims(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * The user from the held token, or null. A token without a recognized role is dropped (memory,
 * sessionStorage and the marker cookie) so it is never sent again.
 */
function tokenUser() {
  if (!accessToken) return null;
  const claims = decodeClaims(accessToken);
  const user = userFromClaims(claims);
  if (!user) {
    if (claims) rejection = ROLE_NOT_RECOGNIZED;
    clearToken();
  }
  return user;
}

/** The signed-in user from the token claims (display and navigation only; servers enforce access). */
export function currentUser() {
  hydrate();
  return tokenUser();
}

async function toApiError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* not JSON */
  }
  const error = body?.error;
  return new ApiError(error?.message ?? 'Something went wrong. Please try again.', {
    code: error?.code,
    status: response.status,
    details: error?.details,
    correlationId: error?.correlation_id,
  });
}

function networkError() {
  return new ApiError('Cannot reach the server. Check your connection and try again.', { code: 'NETWORK_ERROR' });
}

function identityUnavailable() {
  return new ApiError('The sign-in service is not available right now. Please try again in a few minutes.', { code: 'IDENTITY_UNAVAILABLE', status: 503 });
}

/** A wait in whole seconds as people read it: "59 seconds", "1 minute", "14 minutes 44 seconds". */
export function formatWait(totalSeconds) {
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return unit(seconds, 'second');
  return seconds === 0 ? unit(minutes, 'minute') : `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`;
}

const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password';
const SIGN_IN_UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable. Please try again in a few minutes.';

/**
 * Sign-in failures as the person sees them. 401: the generic credentials message. 429: Identity's own
 * rate-limit wait (Retry-After, or the seconds in its message) shown through formatWait, and kept in
 * seconds on the error. 5xx (503 SIGN_IN_UNAVAILABLE and anything else): a fixed safe message, never the server's text.
 */
async function signInError(response) {
  if (response.status === 401) return new ApiError(INVALID_CREDENTIALS_MESSAGE, { code: 'INVALID_CREDENTIALS', status: 401 });
  if (response.status >= 500) return new ApiError(SIGN_IN_UNAVAILABLE_MESSAGE, { code: 'SIGN_IN_UNAVAILABLE', status: response.status });
  const error = await toApiError(response);
  if (response.status !== 429) return error;
  const wait = Number(response.headers.get('retry-after'));
  // Identity words the wait in seconds; the header (or, failing that, that number) is shown in minutes.
  const inMessage = error.code === 'RATE_LIMITED' ? Number(/in (\d+) seconds?\./.exec(error.message)?.[1]) : NaN;
  const seconds = [wait, inMessage].find((n) => Number.isInteger(n) && n > 0);
  const retryAfterSeconds = seconds;
  const message = seconds
    ? `Too many sign-in attempts. Try again in ${formatWait(seconds)}.`
    : 'Too many sign-in attempts. Please wait a moment and try again.';
  const limited = new ApiError(message, { code: 'RATE_LIMITED', status: 429, correlationId: error.correlationId });
  limited.retryAfterSeconds = retryAfterSeconds;
  return limited;
}

/** Keeps a new access token, unless its role is not recognized (then nothing is stored). */
function storeToken(data) {
  accessToken = data.access_token;
  expiresAt = Date.now() + data.expires_in * 1000;
  if (!tokenUser()) return false;
  rejection = null;
  persist();
  return true;
}

/**
 * Resolves the signed-in user, or null if signed out. A token that is still valid is used as it is
 * (no call to Identity); pass force to ask Identity for a new one. Throws IDENTITY_UNAVAILABLE when
 * Identity cannot be reached (network error or a 5xx from the gateway) instead of signing out.
 */
export function refreshSession(force = false) {
  hydrate();
  if (!force && tokenIsFresh()) return Promise.resolve(currentUser());
  if (!refreshing) {
    refreshing = (async () => {
      let response;
      try {
        response = await fetch(`${IDENTITY_API}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
      } catch {
        throw identityUnavailable();
      }
      if (response.status >= 500) throw identityUnavailable();
      if (!response.ok) {
        rejection = null;
        clearToken();
        return null;
      }
      storeToken(await response.json());
      return currentUser();
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function getAccessToken() {
  hydrate();
  if (tokenIsFresh()) return accessToken;
  try {
    const user = await refreshSession(true);
    return user ? accessToken : null;
  } catch (error) {
    // Identity is unreachable: keep working on the token we still have until it really expires.
    if (error?.code === 'IDENTITY_UNAVAILABLE' && tokenIsValid()) return accessToken;
    throw error;
  }
}

export function redirectToLogin() {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export async function signIn(email, password) {
  let response;
  try {
    response = await fetch(`${IDENTITY_API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) throw await signInError(response);
  if (!storeToken(await response.json())) {
    throw new ApiError(ROLE_NOT_RECOGNIZED_MESSAGE, { code: ROLE_NOT_RECOGNIZED, status: 403 });
  }
  return currentUser();
}

/**
 * Asks Identity to revoke the refresh token and clear its cookie (the cookie only clears when Identity
 * itself answers). Returns true when Identity confirmed it.
 */
export async function revokeServerSession() {
  try {
    const response = await fetch(`${IDENTITY_API}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Signs out now (no confirmation; the Sign out button confirms first through useSignOut). Revokes the
 * server session, clears the saved token and does a full page load, which also drops in-memory state.
 * Signed out: the sign-in page (not the public home page). If Identity could not confirm, the sign-in page retries the
 * revocation (?signed_out=1) and says so if that fails too (&notice=revoke_failed), so the person is
 * never silently kept in. Never rejects.
 */
export function signOut() {
  return performSignOut({
    revoke: revokeServerSession,
    clearToken,
    navigate: (url) => window.location.assign(url),
  });
}

/** Calls an API through the gateway with the bearer token; refreshes once on 401. */
export async function apiFetch(path, { method = 'GET', body, headers } = {}, retried = false) {
  const token = await getAccessToken();
  if (!token) {
    redirectToLogin();
    throw new ApiError('Your session has ended. Please sign in again.', { status: 401, code: 'SESSION_ENDED' });
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${token}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw networkError();
  }

  if (response.status === 401 && !retried) {
    // Forget only the token that was refused. If a concurrent request already replaced it, keep the
    // new one so the retry reuses it instead of starting another refresh.
    if (token === accessToken) clearToken();
    return apiFetch(path, { method, body, headers }, true);
  }
  if (response.status === 401) {
    redirectToLogin();
    throw await toApiError(response);
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return null;
  return response.json();
}
