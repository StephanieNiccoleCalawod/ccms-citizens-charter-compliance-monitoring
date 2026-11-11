// TT5: fail-closed QA boundaries. These checks run only when a future QA process is explicitly started.
// They never probe a network, open a database or reveal connection strings.
const localHost = (host) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
const fail = (message) => { throw new Error(`QA isolation: ${message}`); };
const list = (value, label) => {
  try {
    const parsed = JSON.parse(value ?? 'null');
    if (!Array.isArray(parsed) || !parsed.length || parsed.some((v) => typeof v !== 'string' || !v.trim())) fail(`${label} must be a nonempty list`);
    return parsed;
  } catch { fail(`${label} must be a nonempty JSON list`); }
};

export function qaDatabaseIdentity(value) {
  let url;
  try { url = new URL(value); } catch { fail('a database URL is missing or invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) fail('a PostgreSQL database is required');
  return `${url.hostname.toLowerCase().replace('-pooler.', '.')}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}

export function qaOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('a service URL is missing or invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('service URLs must be HTTP(S) without embedded credentials');
  return url.origin;
}

export function assertQaServiceTargets(env = process.env) {
  if (env.CCMS_ENVIRONMENT !== 'qa') return;
  if (!/^qa-[a-z0-9-]+$/.test(env.QA_TARGET_SET_ID ?? '')) fail('QA_TARGET_SET_ID must explicitly identify the QA set');
  if (!['local', 'hosted'].includes(env.QA_ENV_TYPE)) fail('QA_ENV_TYPE must be local or hosted');
  let services;
  try { services = JSON.parse(env.QA_SERVICES_JSON); } catch { fail('QA_SERVICES_JSON is required'); }
  const required = ['identity-service', 'core-service', 'operations-service', 'oversight-service', 'api-gateway', 'frontend'];
  if (!services || required.some((name) => !services[name])) fail('all six QA service addresses are required');
  const protectedOrigins = list(env.QA_PROTECTED_SERVICE_ORIGINS_JSON, 'protected service origins').map(qaOrigin);
  const qaOrigins = required.map((name) => qaOrigin(services[name]));
  if (new Set(qaOrigins).size !== required.length) fail('QA services need distinct origins');
  const mock = qaOrigin(env.QA_MOCK_ORIGIN);
  const mailbox = qaOrigin(env.QA_MAILBOX_ORIGIN);
  if (env.QA_MAIL_MODE !== 'capture' || !env.SMTP_HOST || !env.SMTP_PORT) fail('a dedicated capture mailbox is required');
  if (qaOrigins.includes(mock) || qaOrigins.includes(mailbox)) fail('mock and mail services must be separate from the application origins');
  for (const origin of [...qaOrigins, mock, mailbox]) {
    if (protectedOrigins.includes(origin)) fail('a QA destination points to a protected environment');
    const parsed = new URL(origin);
    if (env.QA_ENV_TYPE === 'hosted' && (parsed.protocol !== 'https:' || localHost(parsed.hostname))) fail('hosted QA destinations require HTTPS and must not be localhost');
    if (env.QA_ENV_TYPE === 'local' && !localHost(parsed.hostname)) fail('local QA destinations must stay on loopback');
  }
  const targets = {
    API_GATEWAY_URL: 'api-gateway', PUBLIC_BASE_URL: 'frontend', IDENTITY_JWKS_URL: 'identity-service',
    IDENTITY_SERVICE_URL: 'identity-service', IDENTITY_URL: 'identity-service',
    CORE_SERVICE_URL: 'core-service', CORE_URL: 'core-service', CCMS_CALENDAR_URL: 'core-service',
    LOGS_SERVICE_URL: 'oversight-service', LOGS_URL: 'oversight-service',
    OPERATIONS_SERVICE_URL: 'operations-service', OPERATIONS_URL: 'operations-service',
  };
  for (const [key, service] of Object.entries(targets)) {
    if (!env[key] || qaOrigin(env[key]) !== qaOrigin(services[service])) fail(`${key} must point to its own QA service; fallback addresses are refused`);
  }
  for (const key of ['FMS_URL', 'SMS_URL', 'AUDIT_URL', 'EMAIL_API_URL']) {
    if (env[key] && qaOrigin(env[key]) !== mock) fail(`${key} must point to the QA capture/mock service`);
  }
  if (env.SMTP_HOST && (env.SMTP_HOST !== env.QA_SMTP_HOST || String(env.SMTP_PORT) !== String(env.QA_SMTP_PORT))) fail('SMTP must point to the dedicated QA mailbox');
  if (env.SMTP_HOST && env.QA_ENV_TYPE === 'local' && !localHost(env.SMTP_HOST)) fail('local QA SMTP must stay on loopback');
  if (env.HOLIDAY_AUTO_IMPORT !== 'false') fail('QA calendar data must come from its fixtures, not live holiday imports');
  if (env.VERIFY_TOKENS !== 'true') fail('token verification must be explicitly enabled in QA');
  if (!String(env.JWT_ISSUER ?? '').startsWith('ccms-identity-qa-')) fail('QA must use its own token issuer');
}

export function assertQaDatabaseTarget(url, { env = process.env, synchronize = false } = {}) {
  if (env.CCMS_ENVIRONMENT !== 'qa') return;
  assertQaServiceTargets(env);
  if (synchronize || env.DB_SYNCHRONIZE !== 'false') fail('schema synchronization is disabled; use numbered migrations');
  const identity = qaDatabaseIdentity(url);
  const allowed = list(env.QA_DATABASE_IDENTITIES_JSON, 'QA database identities');
  const protectedTargets = list(env.QA_PROTECTED_DATABASE_IDENTITIES_JSON, 'protected database identities');
  if (allowed.length !== 4 || new Set(allowed).size !== 4) fail('four distinct QA database identities are required');
  if (allowed.some((item) => protectedTargets.includes(item))) fail('QA and protected database sets overlap');
  if (!allowed.includes(identity) || identity !== env.QA_DATABASE_IDENTITY || protectedTargets.includes(identity)) fail('the connection is not the assigned QA database');
  if (env.QA_ENV_TYPE === 'local' && !localHost(new URL(url).hostname)) fail('local QA databases must stay on loopback');
  if (env.QA_ENV_TYPE === 'hosted' && env.DB_TARGET !== 'hosted') fail('hosted QA requires DB_TARGET=hosted');
  // Baseline provisioning alters fixed, cluster-wide audit roles. A different database name on the
  // demo cluster is insufficient: Oversight needs its own PostgreSQL cluster or isolated Neon branch.
  if (env.QA_SERVICE_KIND === 'oversight-service') {
    const cluster = identity.split('/')[0];
    if (env.QA_OVERSIGHT_CLUSTER_ISOLATED !== 'true' || protectedTargets.some((target) => target.split('/')[0] === cluster)) fail('Oversight QA must use an isolated cluster, not a protected database server');
  }
}
