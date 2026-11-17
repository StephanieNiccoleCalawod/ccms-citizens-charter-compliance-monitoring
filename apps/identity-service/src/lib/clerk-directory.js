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

// ---------------------------------------------------------------------------------------------------------------------
// Flow A ("new person, no Clerk login yet"): CCCMS sends the Clerk invitation itself. The only writes CCCMS ever makes in
// Clerk are creating and revoking ITS OWN invitations (R5); users are never changed (R4). The invitation carries one opaque
// reference under public_metadata.cccms (R2), which Clerk copies to the new user's public metadata on sign-up; Identity
// reads it back with getUser at the person's first sign-in (decision "b": Backend API, no instance-wide session claim).
// Off unless CLERK_INVITATIONS_ENABLED=true AND CLERK_SECRET_KEY is set. Turn it on only after the clerk_invitations
// migration has run (the exchange reads that table while the switch is on).

export function invitationSettings(env = process.env) {
  const base = directorySettings(env);
  const publicBase = String(env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return {
    ...base,
    enabled: env.CLERK_INVITATIONS_ENABLED === 'true',
    // Where Clerk sends the person after they accept. Must be allowed by the instance owner (playbook D2).
    redirectUrl: String(env.CLERK_INVITATION_REDIRECT_URL ?? '').trim() || (publicBase ? `${publicBase}/login/clerk` : ''),
  };
}

/** True when Flow A can be offered on the screen and used at sign-in. */
export function invitationsAvailable(settings = invitationSettings()) {
  return settings.enabled && Boolean(settings.secretKey);
}

/** 404 while switched off, 503 when switched on without a key. */
export function requireInvitations(settings = invitationSettings()) {
  if (!settings.enabled) throw Errors.notFound('Not found', 'ROUTE_NOT_FOUND');
  if (!settings.secretKey) throw Errors.unavailable('Sending Clerk invitations is not configured.', 'CLERK_INVITATIONS_NOT_CONFIGURED');
  return settings;
}

/** A write call. Returns { ok, status, body }; network trouble and 5xx become 503, a rejected key 503 (not configured). */
async function send(settings, method, path, body) {
  let response;
  try {
    response = await fetchImpl(`${settings.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${settings.secretKey}`, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 401 || response.status === 403) {
    throw Errors.unavailable('Sending Clerk invitations is not configured correctly.', 'CLERK_INVITATIONS_NOT_CONFIGURED');
  }
  if (response.status >= 500 || response.status === 429) throw unavailable();
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

const clerkErrorCode = (body) => (Array.isArray(body?.errors) && typeof body.errors[0]?.code === 'string' ? body.errors[0].code : null);

/**
 * Creates a Clerk invitation for `email` carrying { cccms: { invitation: ref } } as public metadata. Returns the Clerk
 * invitation ID. A refusal by Clerk (for example the address already has a Clerk login) is a 409 with Clerk's error code.
 */
export async function createInvitation(settings, { email, ref }) {
  const payload = { email_address: norm(email), public_metadata: { cccms: { invitation: ref } }, notify: true };
  if (settings.redirectUrl) payload.redirect_url = settings.redirectUrl;
  const result = await send(settings, 'POST', '/v1/invitations', payload);
  if (!result.ok || typeof result.body?.id !== 'string') {
    const code = clerkErrorCode(result.body);
    throw Errors.conflict(
      code === 'duplicate_record' || code === 'form_identifier_exists'
        ? 'This email already has a Clerk login or a pending invitation. Use "Find in Clerk" instead.'
        : 'Clerk did not accept the invitation. Check the email address and try again.',
      'CLERK_INVITATION_REFUSED',
      code ? { clerk_code: code } : null,
    );
  }
  return result.body.id;
}

/** Revokes one of CCCMS's own invitations (R5). Already accepted, revoked or unknown to Clerk is not an error here. */
export async function revokeInvitation(settings, invitationId) {
  const result = await send(settings, 'POST', `/v1/invitations/${encodeURIComponent(invitationId)}/revoke`);
  return { revokedInClerk: result.ok };
}

/** The Flow A reference Clerk copied from the invitation into the user's public metadata, or null. Reads only our key. */
export function invitationRefOf(user) {
  const ref = user?.public_metadata?.cccms?.invitation;
  return typeof ref === 'string' && ref.length >= 32 && ref.length <= 128 ? ref : null;
}
