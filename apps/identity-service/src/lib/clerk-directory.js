import { Errors } from 'ccms-shared';

// Clerk sign-in, Flow B ("already has a Clerk account"), Shared Clerk Access Playbook. A Super Admin looks up, by the CCMS
// account's own email, whether that person already has a Clerk login, and binds the account to it without waiting for a
// first sign-in. This needs the Clerk Backend API and therefore a Clerk Secret Key (playbook D1).
//
// Rules kept here:
//   R6  search by one exact email only (the account's own email); never list or export the instance.
//   R4  read only: nothing in Clerk is created, changed, banned or deleted.
//   R8  the Secret Key is read on the server only (Identity), never logged and never returned.
// Off unless CLERK_DIRECTORY_ENABLED=true AND CLERK_SECRET_KEY is set. Turning it on needs the D1 agreement of the instance
// owner and the other two teams.

const TIMEOUT_MS = 8000;
let fetchImpl = (...args) => fetch(...args);

/** Tests replace fetch; pass null to restore. */
export function setDirectoryFetch(fn) {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

export function directorySettings(env = process.env) {
  return {
    enabled: env.CLERK_DIRECTORY_ENABLED === 'true',
    secretKey: String(env.CLERK_SECRET_KEY ?? '').trim(),
    apiUrl: String(env.CLERK_API_URL ?? '').trim().replace(/\/+$/, '') || 'https://api.clerk.com',
  };
}

/** True when Flow B can be offered on the screen. */
export function directoryAvailable(settings = directorySettings()) {
  return settings.enabled && Boolean(settings.secretKey);
}

/** 404 while switched off (the routes do not exist for callers), 503 when switched on without a key. */
export function requireDirectory(settings = directorySettings()) {
  if (!settings.enabled) throw Errors.notFound('Not found', 'ROUTE_NOT_FOUND');
  if (!settings.secretKey) throw Errors.unavailable('Finding people in Clerk is not configured.', 'CLERK_DIRECTORY_NOT_CONFIGURED');
  return settings;
}

const unavailable = () => Errors.unavailable('Clerk could not be reached. Please try again in a few minutes.', 'CLERK_DIRECTORY_UNAVAILABLE');

async function call(settings, path) {
  let response;
  try {
    response = await fetchImpl(`${settings.apiUrl}${path}`, {
      headers: { authorization: `Bearer ${settings.secretKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw Errors.unavailable('Finding people in Clerk is not configured correctly.', 'CLERK_DIRECTORY_NOT_CONFIGURED');
  }
  if (!response.ok) throw unavailable();
  try {
    return await response.json();
  } catch {
    throw unavailable();
  }
}

const norm = (email) => String(email ?? '').trim().toLowerCase();

/** The person as CCMS shows it: the Clerk user ID, the matching verified email, a display name. Nothing else leaves Clerk. */
function toPerson(user, email) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return { clerk_user_id: user.id, email, name: name || null, banned: user.banned === true, locked: user.locked === true };
}

/** The verified email address of a Clerk user that equals `email` exactly (any letter case), or null. */
export function verifiedMatch(user, email) {
  const wanted = norm(email);
  const found = (user?.email_addresses ?? []).find((a) => norm(a.email_address) === wanted && a.verification?.status === 'verified');
  return found ? norm(found.email_address) : null;
}

/** Clerk users whose VERIFIED email is exactly `email`. One exact address per call (R6). */
export async function findUsersByEmail(settings, email) {
  const exact = norm(email);
  if (!exact) return [];
  const users = await call(settings, `/v1/users?email_address=${encodeURIComponent(exact)}&limit=10`);
  return (Array.isArray(users) ? users : [])
    .map((user) => ({ user, match: verifiedMatch(user, exact) }))
    .filter((x) => x.match && typeof x.user?.id === 'string')
    .map((x) => toPerson(x.user, x.match));
}

/** One Clerk user by ID, or null when Clerk does not know it. */
export async function getUser(settings, clerkUserId) {
  return call(settings, `/v1/users/${encodeURIComponent(clerkUserId)}`);
}
