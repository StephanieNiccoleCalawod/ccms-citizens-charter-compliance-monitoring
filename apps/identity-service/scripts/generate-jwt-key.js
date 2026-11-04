// npm run keygen
// Prints a new RS256 signing key as a one-line value for JWT_PRIVATE_KEY.
// Identity signs access tokens with it; every serverless instance must use the SAME key, so set it
// once in the Vercel project's Environment Variables (and in .env.local for local production runs).
// Keep it secret: anyone with this key can create tokens. Never commit it.
import { exportPKCS8, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const pem = await exportPKCS8(privateKey);
console.log(`JWT_PRIVATE_KEY="${pem.trim().replace(/\n/g, '\\n')}"`);
