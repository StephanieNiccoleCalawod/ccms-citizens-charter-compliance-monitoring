import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { Errors } from 'ccms-shared';

// Clerk sign-in (Landas 1). Identity is the only CCMS service that reads Clerk tokens: it verifies the Clerk session token
// and, for a person a Super Admin has bound to a CCMS account, issues the usual CCMS access token. Every other service keeps
// verifying CCMS tokens exactly as before.
//
// Verification is networkless with the instance's JWKS Public Key (PEM) and needs no Clerk Secret Key (Shared Clerk Access
// Playbook D1; Clerk docs: verifyToken "Networkless if the jwtKey is provided"). Several PEMs may be configured during a
// key rotation window. Checks (docs/clerk-integration-analysis.md section 16.4):
//   alg RS256 only | signature | iss = CLERK_ISSUER exactly | exp, nbf with 5 s tolerance | azp present and allowlisted
//   sub is a Clerk user ID | sid present | v = 2 when present | sts not "pending" | no act (impersonation) unless allowed
// Session tokens carry no aud claim, so none is required. The email claim is returned as a hint only; it never grants access.

const CLOCK_TOLERANCE_SECONDS = 5;
const SUBJECT_RE = /^user_[A-Za-z0-9]+$/;
const list = (value) => String(value ?? '').split(',').map((v) => v.trim().replace(/\/+$/, '')).filter(Boolean);

/** Clerk settings, read on use so tests and deployments can change them. */
export function clerkSettings(env = process.env) {
  const pemText = String(env.CLERK_JWT_KEY ?? '').replace(/\\n/g, '\n');
  return {
    enabled: env.CLERK_AUTH_ENABLED === 'true',
    issuer: String(env.CLERK_ISSUER ?? '').trim().replace(/\/+$/, ''),
    jwtKeys: pemText.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [],
    authorizedParties: list(env.CLERK_AUTHORIZED_PARTIES),
    allowImpersonation: env.CLERK_ALLOW_IMPERSONATION === 'true',
    emailClaim: String(env.CLERK_EMAIL_CLAIM ?? '').trim() || 'email',
  };
}

/** 404 when Clerk sign-in is switched off, so the routes do not exist for callers until the flag is on. */
export function requireClerkEnabled(settings = clerkSettings()) {
  if (!settings.enabled) throw Errors.notFound('Not found', 'ROUTE_NOT_FOUND');
  return settings;
}

const keyCache = new Map();
function importKey(pem) {
  if (!keyCache.has(pem)) {
    const pending = importSPKI(pem, 'RS256');
    pending.catch(() => keyCache.delete(pem)); // a bad PEM is retried after the configuration is fixed
    keyCache.set(pem, pending);
  }
  return keyCache.get(pem);
}

const invalid = () => Errors.unauthorized('Your sign-in could not be verified. Please sign in again.', 'INVALID_CLERK_TOKEN');
const notConfigured = () => Errors.unavailable('Sign-in with Clerk is not available right now. Please try again later.', 'CLERK_NOT_CONFIGURED');

/**
 * Verifies a Clerk session token. Returns { issuer, subject, sessionId, email, actor }; throws 401 for any token problem,
 * 403 for impersonation (unless allowed) and 503 when Clerk verification is not configured.
 */
export async function verifyClerkToken(token, settings = clerkSettings()) {
  if (!settings.issuer || !settings.jwtKeys.length || !settings.authorizedParties.length) throw notConfigured();
  if (typeof token !== 'string' || !token) throw invalid();

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw invalid();
  }
  if (header.alg !== 'RS256') throw invalid();

  let keys;
  try {
    keys = await Promise.all(settings.jwtKeys.map(importKey));
  } catch {
    throw notConfigured();
  }

  let payload = null;
  for (const key of keys) {
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: settings.issuer,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp', 'iat', 'sub', 'sid'],
      }));
      break;
    } catch (err) {
      if (err?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') continue; // try the next configured key
      throw invalid();
    }
  }
  if (!payload) throw invalid();

  if (typeof payload.sub !== 'string' || !SUBJECT_RE.test(payload.sub)) throw invalid();
  if (typeof payload.sid !== 'string' || !payload.sid) throw invalid();
  if (payload.v !== undefined && payload.v !== 2) throw invalid();
  if (payload.sts === 'pending') throw invalid();
  const azp = typeof payload.azp === 'string' ? payload.azp.replace(/\/+$/, '') : '';
  if (!azp || !settings.authorizedParties.includes(azp)) throw invalid();
  if (payload.act && !settings.allowImpersonation) {
    throw Errors.forbidden('Signing in as another person is not allowed in CCMS.', 'IMPERSONATION_NOT_ALLOWED');
  }

  const rawEmail = payload[settings.emailClaim];
  const unverified = payload.email_verified === false || payload.email_verified === 'false';
  const email = !unverified && typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim().toLowerCase() : null;
  return { issuer: payload.iss, subject: payload.sub, sessionId: payload.sid, email, actor: payload.act?.sub ?? null };
}
