// Runtime settings, read on use so tests and deployments can change them.
const int = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
  // Access token 15 minutes, refresh token 7 days (proposed values, SHARED_CONTEXT 6.2).
  get accessTokenSeconds() {
    return int('ACCESS_TOKEN_TTL_SECONDS', 15 * 60);
  },
  get refreshTokenDays() {
    return int('REFRESH_TOKEN_TTL_DAYS', 7);
  },
  // Password reset link expiry is a setting.
  get resetLinkMinutes() {
    return int('PASSWORD_RESET_TTL_MINUTES', 60);
  },
  get issuer() {
    return process.env.JWT_ISSUER || 'ccms-identity';
  },
  get audience() {
    return process.env.JWT_AUDIENCE || 'ccms';
  },
  get coreUrl() {
    return (process.env.CORE_SERVICE_URL || 'http://127.0.0.1:3003/api').replace(/\/$/, '');
  },
  // The gateway origin people use in the browser; used in emailed links.
  get publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  },
  // Path under which the gateway exposes this service's API (cookie scope).
  get publicApiBase() {
    return (process.env.PUBLIC_API_BASE || '/api/identity').replace(/\/$/, '');
  },
  get cookieSecure() {
    if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
    return this.isProduction;
  },
};

// PM DECISION REQUIRED: password rules. Minimum 8 characters until decided.
export const MIN_PASSWORD_LENGTH = 8;
