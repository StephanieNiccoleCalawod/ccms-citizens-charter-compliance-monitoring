// CCMS — Clerk provider configuration checker (read-only). See docs/clerk-integration-analysis.md section 15.2.
// Usage (from the repo root):  node scripts/clerk-config-check.mjs <path-to-config.json> [--offline]
//
// config.json (keep it OUTSIDE the repo; do not commit):
// {
//   "frontendApiUrl": "https://...",
//   "backendApiUrl": "https://...",
//   "jwksUrl": "https://.../.well-known/jwks.json",
//   "jwksPublicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
//   "publishableKey": "pk_..."
// }
// Prints only PASS/FAIL/WARN lines. Never prints the publishable key, the PEM, or key material.
// The only network call is a GET of the public JWKS URL (skipped with --offline). No secret key is used or needed.

import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';

const [, , file, flag] = process.argv;
if (!file) {
  console.error('Usage: node scripts/clerk-config-check.mjs <config.json> [--offline]');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(file, 'utf8'));
const results = [];
const out = (status, check, note = '') => results.push({ status, check, note });

const host = (u) => {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
};
const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

// 1. Publishable key: prefix and embedded Frontend API host.
const pk = String(cfg.publishableKey ?? '').trim();
const pkMatch = /^pk_(live|test)_([A-Za-z0-9+/=_-]+)$/.exec(pk);
let pkKind = null;
let pkHost = null;
if (!pkMatch) out('FAIL', 'Publishable key format', 'expected pk_live_… or pk_test_…');
else {
  pkKind = pkMatch[1];
  out('PASS', 'Publishable key format', `kind = ${pkKind === 'live' ? 'PRODUCTION (pk_live)' : 'DEVELOPMENT (pk_test)'}`);
  try {
    const decoded = Buffer.from(pkMatch[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (decoded.endsWith('$')) {
      pkHost = decoded.slice(0, -1).toLowerCase();
      out('PASS', 'Publishable key decodes to a Frontend API host');
    } else out('FAIL', 'Publishable key decodes to a Frontend API host', 'decoded value does not end with "$"');
  } catch {
    out('FAIL', 'Publishable key decodes to a Frontend API host', 'not valid base64');
  }
}

// 2. Frontend API URL.
const fapi = String(cfg.frontendApiUrl ?? '').trim();
const fapiHost = host(fapi.startsWith('http') ? fapi : `https://${fapi}`);
if (!fapiHost) out('FAIL', 'Frontend API URL parses');
else {
  out(isHttps(fapi.startsWith('http') ? fapi : `https://${fapi}`) ? 'PASS' : 'FAIL', 'Frontend API URL uses HTTPS');
  const devHost = /\.clerk\.accounts\.dev$/.test(fapiHost);
  out('INFO', 'Frontend API host type', devHost ? 'Clerk-hosted development domain (*.clerk.accounts.dev)' : 'custom domain (expected for production, e.g. clerk.<your-domain>)');
  if (pkKind === 'live' && devHost) out('FAIL', 'Production key vs host', 'pk_live with a *.clerk.accounts.dev host is inconsistent');
  if (pkKind === 'test' && !devHost) out('WARN', 'Development key vs host', 'pk_test normally pairs with *.clerk.accounts.dev');
  if (pkHost) out(pkHost === fapiHost ? 'PASS' : 'FAIL', 'Publishable key and Frontend API URL are the SAME instance', pkHost === fapiHost ? '' : 'host embedded in the key differs from the Frontend API URL');
}

// 3. Backend API URL.
const bapiHost = host(String(cfg.backendApiUrl ?? '').trim());
if (!bapiHost) out('FAIL', 'Backend API URL parses');
else {
  out(bapiHost === 'api.clerk.com' ? 'PASS' : 'WARN', 'Backend API host is api.clerk.com', bapiHost === 'api.clerk.com' ? 'note: this host is shared by ALL instances; the Secret Key selects the instance' : 'unexpected host; confirm with provider');
  out(isHttps(cfg.backendApiUrl) ? 'PASS' : 'FAIL', 'Backend API URL uses HTTPS');
}

// 4. JWKS URL.
const jwksUrl = String(cfg.jwksUrl ?? '').trim();
const jwksHost = host(jwksUrl);
let jwksPath = null;
try {
  jwksPath = new URL(jwksUrl).pathname.replace(/\/+$/, '');
} catch {}
if (!jwksHost) out('FAIL', 'JWKS URL parses');
else if (jwksHost === fapiHost && jwksPath === '/.well-known/jwks.json') out('PASS', 'JWKS URL = <Frontend API>/.well-known/jwks.json', 'public, no secret needed: correct for gateway/services');
else if (jwksHost === 'api.clerk.com' && jwksPath === '/v1/jwks') out('WARN', 'JWKS URL is the Backend API /v1/jwks', 'requires the Secret Key; prefer <Frontend API>/.well-known/jwks.json for verifiers');
else out('FAIL', 'JWKS URL belongs to the same instance', 'host/path does not match the Frontend API');

// 5. JWKS public key (PEM).
let pemJwk = null;
try {
  const pem = String(cfg.jwksPublicKeyPem ?? '').replace(/\\n/g, '\n');
  const key = createPublicKey(pem);
  pemJwk = key.export({ format: 'jwk' });
  out(pemJwk.kty === 'RSA' ? 'PASS' : 'FAIL', 'JWKS public key is an RSA public key', `modulus bits ≈ ${Buffer.from(pemJwk.n ?? '', 'base64url').length * 8}`);
} catch {
  out('FAIL', 'JWKS public key parses as a PEM public key');
}

// 6. Live JWKS: does the PEM match a published key? (public endpoint only)
if (flag !== '--offline' && jwksHost) {
  try {
    const res = await fetch(jwksUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) out('FAIL', 'JWKS URL reachable', `HTTP ${res.status}`);
    else {
      const body = await res.json();
      const keys = Array.isArray(body?.keys) ? body.keys : [];
      out(keys.length ? 'PASS' : 'FAIL', 'JWKS URL returns keys', `count = ${keys.length}`);
      const algs = [...new Set(keys.map((k) => k.alg ?? '(none)'))].join(',');
      out(keys.every((k) => k.kty === 'RSA' && (!k.alg || k.alg === 'RS256')) ? 'PASS' : 'WARN', 'Published keys are RSA / RS256', `alg = ${algs}`);
      if (pemJwk) {
        const match = keys.find((k) => k.n === pemJwk.n && k.e === pemJwk.e);
        out(match ? 'PASS' : 'FAIL', 'Provided PEM matches a key in the live JWKS', match ? 'same instance, current key' : 'PEM is from another instance or an older (rotated) key');
      }
    }
  } catch (err) {
    out('FAIL', 'JWKS URL reachable', err?.name ?? 'network error');
  }
} else if (flag === '--offline') out('INFO', 'Live JWKS check skipped (--offline)');

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.check.padEnd(width)}  ${r.note}`);
const failed = results.some((r) => r.status === 'FAIL');
console.log(failed ? '\nRESULT: NOT CONSISTENT — do not use this configuration yet.' : '\nRESULT: consistent (see WARN/INFO lines).');
// exitCode, not process.exit(): exiting while fetch handles are still closing crashes Node on Windows (libuv assertion).
process.exitCode = failed ? 1 : 0;
