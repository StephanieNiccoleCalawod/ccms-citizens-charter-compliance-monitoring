import { fileURLToPath } from 'node:url';
import { assertQaServiceTargets } from 'ccms-shared/qa';

assertQaServiceTargets();

// The browser only ever talks to this app. Everything under /api is forwarded to the API gateway
// (a separate Vercel project), which checks the token and routes to Identity, Core and Logs.
// Because the browser sees ONE address, the sign-in cookies (refresh token and the signed-in marker)
// are first-party cookies and need no cross-site settings.
const gatewayUrl = (process.env.API_GATEWAY_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CCMS_ENVIRONMENT === 'qa' && process.env.QA_ENV_TYPE === 'local' ? '.next-qa' : '.next',
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  // Hides the dev-only route badge. Compile and runtime errors are still shown by Next.js.
  devIndicators: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${gatewayUrl}/api/:path*` }];
  },
  // Clerk-only production: when the build is set to clerk mode (NEXT_PUBLIC_AUTH_PROVIDER=clerk with a publishable key),
  // the old password page at /login is not shown — every hit on /login is sent to the Clerk sign-in. This is the single
  // authoritative switch, so every existing link to /login reaches the Clerk flow without each link having to know the mode.
  // Non-permanent (307) on purpose: a rollback to dual must never be cached. In legacy/dual (local, QA) there is no redirect
  // and /login keeps working. These are build-time NEXT_PUBLIC_* values, read the same way the client reads them.
  async redirects() {
    const provider = String(process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? '').trim().toLowerCase();
    const hasKey = /^pk_(test|live)_/.test(String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').trim());
    if (provider !== 'clerk' || !hasKey) return [];
    return [{ source: '/login', destination: '/login/clerk', permanent: false }];
  },
};

export default nextConfig;
