import { fileURLToPath } from 'node:url';
import { assertQaServiceTargets } from 'ccms-shared/qa';

assertQaServiceTargets();

// Operations (Transaction) is an API-only service: no pages, no static assets. The browser never calls it
// directly; every request arrives through ccms-api-gateway (/api/operations/* is forwarded here as /api/*).
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CCMS_ENVIRONMENT === 'qa' && process.env.QA_ENV_TYPE === 'local' ? '.next-qa' : '.next',
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  serverExternalPackages: ['pg', 'typeorm'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
