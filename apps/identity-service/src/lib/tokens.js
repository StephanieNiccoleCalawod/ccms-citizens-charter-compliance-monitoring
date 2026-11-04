import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, importPKCS8 } from 'jose';
import { config } from './config.js';

// Identity signs tokens with RS256 and publishes the public key (JWKS) so every other service
// verifies tokens offline. Set JWT_PRIVATE_KEY (PKCS#8 PEM; "\n" escapes are accepted).
// Outside production a throwaway key is generated when it is missing; tokens then stop working
// after a restart, which is fine for development but never for deployments.
const KEY = '__ccmsSigningKeys';

async function loadKeys() {
  let privateKey;
  let publicKey;
  const pem = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (pem) {
    privateKey = await importPKCS8(pem, 'RS256');
    publicKey = createPublicKey(pem);
  } else if (config.isProduction) {
    throw new Error('JWT_PRIVATE_KEY is required in production');
  } else {
    console.warn('[identity] JWT_PRIVATE_KEY is not set: using a temporary signing key (development only).');
    ({ privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true }));
  }
  const jwk = await exportJWK(publicKey);
  const kid = process.env.JWT_KEY_ID || (await calculateJwkThumbprint(jwk));
  return { privateKey, kid, jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } };
}

export function getSigningKeys() {
  globalThis[KEY] ??= loadKeys();
  return globalThis[KEY];
}

/** Claims: sub, employee_no, full_name, role, office_id, iss, aud, iat, exp. */
export async function signAccessToken(account) {
  const { privateKey, kid } = await getSigningKeys();
  return new SignJWT({
    employee_no: account.employeeNo,
    full_name: account.fullName,
    role: account.roleKey,
    office_id: account.officeId ?? null,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setSubject(account.accountId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenSeconds}s`)
    .sign(privateKey);
}

export function newOpaqueToken() {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
