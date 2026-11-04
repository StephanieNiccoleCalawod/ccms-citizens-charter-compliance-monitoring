import { createTokenVerifier, requirePermission } from 'ccms-shared';
import { config } from './config.js';
import { getSigningKeys } from './tokens.js';

// Identity verifies tokens the same way every other service does (RS256 against a JWKS), but
// against its own keys locally instead of fetching them over HTTP.
let localVerifier;
function verify(token) {
  localVerifier ??= createTokenVerifier({
    getJwks: async () => (await getSigningKeys()).jwks,
    issuer: config.issuer,
    audience: config.audience,
  });
  return localVerifier(token);
}

/** requirePermission bound to Identity's verifier. */
export function guard(roles, officeScope = 'campus') {
  return requirePermission(roles, officeScope, { verifier: verify });
}
