import { fileURLToPath } from 'node:url';
import { assertQaServiceTargets } from 'ccms-shared/qa';

assertQaServiceTargets();

// The gateway has no pages: only Route Handlers under /api. Deployed as its own Vercel project; the
// frontend project rewrites /api/* to it, so the browser sees one address.
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CCMS_ENVIRONMENT === 'qa' && process.env.QA_ENV_TYPE === 'local' ? '.next-qa' : '.next',
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
