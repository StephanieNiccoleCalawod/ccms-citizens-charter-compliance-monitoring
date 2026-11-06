import { fileURLToPath } from 'node:url';

// Oversight (Logs) is an API-only service: no pages, no static assets. The browser never calls it
// directly; every request arrives through ccms-api-gateway (/api/logs/* is forwarded here as /api/*).
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  serverExternalPackages: ['pg', 'typeorm'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
