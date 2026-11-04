import { fileURLToPath } from 'node:url';

// The gateway has no pages: only Route Handlers under /api. Deployed as its own Vercel project; the
// frontend project rewrites /api/* to it, so the browser sees one address.
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
