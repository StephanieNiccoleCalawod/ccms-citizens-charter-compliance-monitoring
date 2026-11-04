import { fileURLToPath } from 'node:url';

// Identity is an API-only service: no pages, no static assets. The browser never calls it directly;
// every request arrives through ccms-api-gateway (which is the only public entry point).
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  serverExternalPackages: ['pg', 'typeorm'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
