// Routing table. The browser only ever talks to the gateway:
//   /api/{name}/*   ->   that service's /api/*
// Several names can point at one service: Catalogue and Calendar both live in Core.
// Add a service here when its sprint creates it.

export const SERVICES = {
  identity: { env: 'IDENTITY_URL', fallback: 'http://127.0.0.1:3001' },
  catalogue: { env: 'CORE_URL', fallback: 'http://127.0.0.1:3003' },
  calendar: { env: 'CORE_URL', fallback: 'http://127.0.0.1:3003' },
  logs: { env: 'LOGS_URL', fallback: 'http://127.0.0.1:3002' },
  // TT2: Oversight (the Logs service) also answers as "analytics" and "reports", like catalogue/calendar for Core.
  // No report or KPI endpoint exists yet; when one does, it is reached here with a user token and checked by Oversight.
  analytics: { env: 'LOGS_URL', fallback: 'http://127.0.0.1:3002' },
  reports: { env: 'LOGS_URL', fallback: 'http://127.0.0.1:3002' },
  operations: { env: 'OPERATIONS_URL', fallback: 'http://127.0.0.1:3004' },
};

// Backend-only endpoints (service-to-service, protected by the shared key). Rules are per SERVICE (the env variable
// of the target), not per alias, so every alias that reaches that service is covered (logs, analytics, reports).
// Paths are the service's own paths; they are compared case-insensitively, after percent-decoding, with trailing
// slashes removed, and also block everything below them.
//   writes   refuse every method except GET/HEAD (GET /api/audit-events is the read-only audit viewer)
//   all      refuse every method, GET and HEAD included
export const BACKEND_ONLY = [
  { env: 'LOGS_URL', path: '/api/audit-events', methods: 'writes' },
  { env: 'LOGS_URL', path: '/api/analytics-events', methods: 'all' },
  { env: 'OPERATIONS_URL', path: '/api/transactions/analytics-export', methods: 'all' },
];
// Kept for compatibility: the browser-facing spelling of the Sprint 2 rule.
export const BLOCKED_API_PATHS = ['/api/logs/audit-events'];
const READ_METHODS = new Set(['GET', 'HEAD']);

// Scheduled jobs belong to each service and are called by Vercel Cron with a secret. They are never
// reachable through the gateway, whatever the method. The same goes for /api/internal (service-key routes).
export const BLOCKED_PREFIXES = ['/api/jobs', '/api/internal'];

// Browser-facing API routes that need no token (RBAC doc 4.4): sign-in, refresh, sign-out and the
// published keys; the public service browse; and every service's health check. Everything else under
// /api needs a valid token. Paths are the service's own paths (after /api/{name} is mapped to /api).
export const PUBLIC_API = {
  identity: ['/api/auth/', '/api/health'],
  catalogue: ['/api/public/', '/api/health'],
  calendar: ['/api/health'],
  // CC032/CC033: a citizen files a complaint and checks its status without an account. Exactly these two paths; the service rate limits them.
  logs: ['/api/complaints', '/api/complaints/status', '/api/health'],
  analytics: ['/api/health'],
  reports: ['/api/health'],
  // CC039: a walk-in takes a queue ticket without an account. Exactly this path; Operations rate limits it per client address.
  // Every other queue route (panel, staff issuance, Call next, Skip) needs a token and is scoped by role and office in Operations.
  operations: ['/api/queue/public/tickets', '/api/health'],
};

// EB6 / EB7: the one machine-to-machine route. FMS pulls the calendar snapshot with a machine key
// (Authorization: Bearer ccms_mk_<ref>.<secret>), which is not a user token, so the user-token check
// is skipped for exactly this path, only for GET/HEAD, and only when the key has the machine-key
// prefix. The gateway does NOT validate the key: Core does, and answers the same 401 for every failure.
// Every other route, method or kind of credential still needs a valid user token.
export const MACHINE_KEY_API = { calendar: ['/api/declarations'] };
export const MACHINE_KEY_PREFIX = 'ccms_mk_';

export function isMachineKeyRequest(name, path, method, token) {
  if (!READ_METHODS.has(String(method).toUpperCase())) return false;
  if (typeof token !== 'string' || !token.startsWith(MACHINE_KEY_PREFIX)) return false;
  const pathname = path.split('?')[0].replace(/\/+$/, '');
  return (MACHINE_KEY_API[name] ?? []).includes(pathname);
}

export function isPublicApi(name, path) {
  const pathname = path.split('?')[0].replace(/\/+$/, '');
  return (PUBLIC_API[name] ?? []).some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}

export function serviceTargets(env = process.env) {
  return Object.fromEntries(Object.entries(SERVICES).map(([name, s]) => [name, (env[s.env] || s.fallback).replace(/\/$/, '')]));
}

/** Decides where a request goes. Returns { name, path } (path keeps the query), { blocked: true } or null. */
export function resolveRoute(url, targets = serviceTargets(), method = 'GET') {
  const queryStart = url.indexOf('?');
  const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart);

  // Refuse ambiguous paths outright (dot segments, doubled or encoded slashes, backslashes) so a
  // crafted URL cannot slip past the routing and blocking rules below.
  if (/(\/\.{1,2}(\/|$))|%2e|%2f|%5c|\/\/|\\/i.test(pathname)) return { blocked: true };

  const match = /^\/api\/([a-z0-9-]+)(\/.*)?$/.exec(pathname);
  if (!match || !targets[match[1]]) return null;
  const path = `/api${match[2] ?? ''}`;
  const trimmed = path.replace(/\/+$/, '');

  // Decoded, lower-case form for the blocking rules, so an alternate spelling (%61, upper case) cannot slip past.
  let normalised;
  try {
    normalised = decodeURIComponent(trimmed).toLowerCase().replace(/\/+$/, '');
  } catch {
    return { blocked: true };
  }
  const under = (p, prefix) => p === prefix || p.startsWith(`${prefix}/`);
  if (BLOCKED_PREFIXES.some((prefix) => under(trimmed, prefix) || under(normalised, prefix))) return { blocked: true };
  const readOnly = READ_METHODS.has(String(method).toUpperCase());
  if (BACKEND_ONLY.some((rule) => reachesService(match[1], rule.env, targets) && (rule.methods === 'all' || !readOnly) && under(normalised, rule.path))) {
    return { blocked: true };
  }
  return { name: match[1], path: path + query };
}

/** True when the alias belongs to the service configured by `env`, or is configured with that service's address. */
function reachesService(name, env, targets) {
  if (SERVICES[name]?.env === env) return true;
  return Object.entries(SERVICES).some(([other, s]) => s.env === env && targets[other] && targets[other] === targets[name]);
}
