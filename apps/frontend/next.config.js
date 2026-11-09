import { fileURLToPath } from 'node:url';

// The browser only ever talks to this app. Everything under /api is forwarded to the API gateway
// (a separate Vercel project), which checks the token and routes to Identity, Core and Logs.
// Because the browser sees ONE address, the sign-in cookies (refresh token and the signed-in marker)
// are first-party cookies and need no cross-site settings.
const gatewayUrl = (process.env.API_GATEWAY_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  // Hides the dev-only route badge. Compile and runtime errors are still shown by Next.js.
  devIndicators: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // Analytics moved into the Dashboard; an old /insights link or bookmark lands there.
  async redirects() {
    return [{ source: '/insights', destination: '/', permanent: false }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${gatewayUrl}/api/:path*` }];
  },
};

export default nextConfig;
