// TT5 operator entry points. Merely importing this source is not environment provisioning.
import { readFile, writeFile, mkdir, access, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { assertQaDatabaseTarget, assertQaServiceTargets, qaDatabaseIdentity } from 'ccms-shared/qa';
import { root, qaDir, apps, services, appEnv, readJson, saveJson, execute, approvedFixtures, redact } from './common.mjs';

const random = () => randomBytes(32).toString('hex');
// dotenv quoting is not JSON escaping. Single quotes preserve the JSON boundary maps verbatim.
const envText = (values) => Object.entries(values).map(([key, value]) => {
  const text = String(value).replace(/\r/g, '').replace(/\n/g, '\\n');
  if (text.includes("'")) throw new Error('Percent-encode single quotes in QA URL credentials before generating environment files');
  return `${key}='${text}'`;
}).join('\n') + '\n';

async function initialize() {
  const config = await readJson(join(root, 'qa', 'targets.local.json'));
  if (config.mail?.mode !== 'capture' || !config.mail.smtpHost || !config.mail.smtpPort || !config.mail.captureUrl || config.databases?.['oversight-service']?.isolatedCluster !== true) {
    throw new Error('QA requires a dedicated capture mailbox and an isolated Oversight PostgreSQL cluster/Neon branch');
  }
  try { await access(qaDir); throw new Error('The .qa directory already exists; keep its credentials and prepare a separate QA set instead of regenerating it'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const serviceKey = random();
  const cronSecret = random();
  const fmsToken = random();
  const smsToken = random();
  const mockToken = random();
  const fixturePassword = `Qa!${random()}aA7`;
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const common = {
    CCMS_ENVIRONMENT: 'qa', QA_TARGET_SET_ID: config.id, QA_ENV_TYPE: config.kind,
    QA_SERVICES_JSON: JSON.stringify(config.services), QA_MOCK_ORIGIN: config.mocks.origin,
    QA_DATABASE_IDENTITIES_JSON: JSON.stringify(services.map((name) => config.databases[name].identity)),
    QA_PROTECTED_DATABASE_IDENTITIES_JSON: JSON.stringify(config.protected.databaseIdentities),
    QA_PROTECTED_SERVICE_ORIGINS_JSON: JSON.stringify(config.protected.serviceOrigins),
    QA_SMTP_HOST: config.mail.smtpHost, QA_SMTP_PORT: config.mail.smtpPort,
    QA_MAIL_MODE: 'capture', QA_MAILBOX_ORIGIN: config.mail.captureUrl, QA_OVERSIGHT_CLUSTER_ISOLATED: 'true',
    JWT_ISSUER: `ccms-identity-${config.id}`, JWT_AUDIENCE: `ccms-${config.id}`, VERIFY_TOKENS: 'true',
    DB_SYNCHRONIZE: 'false', DB_TARGET: config.kind, TZ: 'UTC',
    DATABASE_SSL: String(config.kind === 'hosted'), DATABASE_SSL_INSECURE: 'false', DB_POOL_MAX: '3',
    COOKIE_SECURE: String(config.kind === 'hosted'), REQUIRE_TLS: String(config.kind === 'hosted'), TRUST_PROXY: String(config.kind === 'hosted'),
  };
  const generated = {};
  for (const app of apps) {
    const defaults = parseEnv(await readFile(join(root, 'apps', app, '.env.example'), 'utf8'));
    // Next loads conventional env files automatically. Shadow every existing key, but never copy its value into QA.
    const shadow = {};
    for (const file of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']) {
      try { for (const key of Object.keys(parseEnv(await readFile(join(root, 'apps', app, file), 'utf8')))) shadow[key] = ''; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const values = { ...defaults, ...shadow, ...common, QA_SERVICE_KIND: app,
      API_GATEWAY_URL: config.services['api-gateway'], PUBLIC_BASE_URL: config.services.frontend,
      IDENTITY_JWKS_URL: `${config.services['identity-service']}/api/auth/jwks`,
      IDENTITY_SERVICE_URL: `${config.services['identity-service']}/api`, IDENTITY_URL: config.services['identity-service'],
      CORE_SERVICE_URL: `${config.services['core-service']}/api`, CORE_URL: config.services['core-service'], CCMS_CALENDAR_URL: config.services['core-service'],
      LOGS_SERVICE_URL: `${config.services['oversight-service']}/api`, LOGS_URL: config.services['oversight-service'],
      OPERATIONS_SERVICE_URL: `${config.services['operations-service']}/api`, OPERATIONS_URL: config.services['operations-service'],
      FMS_URL: `${config.mocks.origin}/fms/calendar`, FMS_CALENDAR_TOKEN: fmsToken,
      AUDIT_URL: `${config.mocks.origin}/scms/calendar`, SMS_URL: `${config.mocks.origin}/scms`,
      SMS_SERVICE_TOKEN: smsToken, SMS_CALENDAR_TOKEN: smsToken, SMS_SYNC_ENABLED: 'true', SMS_SEND_ALL_MESSAGES: 'true', SMS_TERMS_ENABLED: 'false',
      HOLIDAY_AUTO_IMPORT: 'false', NEXT_PUBLIC_REGISTRY_DEMO: 'false', NEXT_PUBLIC_ANALYTICS_USE_MOCK_DATA: 'false',
      SMTP_HOST: config.mail.smtpHost, SMTP_PORT: config.mail.smtpPort, SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASS: '',
      EMAIL_FROM: 'CCCMS QA <no-reply@ccms-qa.test>', EMAIL_API_URL: '', EMAIL_API_KEY: '',
      SERVICE_KEY: serviceKey, CRON_SECRET: cronSecret, QA_MOCK_CONTROL_TOKEN: mockToken, QA_FIXTURE_PASSWORD: fixturePassword,
    };
    if (app === 'identity-service') values.JWT_PRIVATE_KEY = pem;
    if (services.includes(app)) {
      const target = config.databases[app];
      const url = process.env[target.urlEnv];
      if (!url) throw new Error(`Provide ${target.urlEnv} through the operator environment`);
      values.DATABASE_URL = url;
      values.DATABASE_ADMIN_URL = process.env[target.adminUrlEnv] || url;
      values.QA_DATABASE_IDENTITY = target.identity;
      if (app === 'oversight-service') {
        const runtime = new URL(url);
        if (decodeURIComponent(runtime.username) !== 'ccms_logs_writer' || !runtime.password || values.DATABASE_ADMIN_URL === url) throw new Error('QA Oversight needs its restricted ccms_logs_writer connection and a separate owner connection');
        values.LOGS_WRITER_PASSWORD = decodeURIComponent(runtime.password);
        values.OVERSIGHT_APP_PASSWORD = random();
      }
      assertQaDatabaseTarget(url, { env: values });
      assertQaDatabaseTarget(values.DATABASE_ADMIN_URL, { env: values });
      if (qaDatabaseIdentity(url) !== qaDatabaseIdentity(values.DATABASE_ADMIN_URL)) throw new Error('QA owner and runtime connections must refer to the same database');
    }
    assertQaServiceTargets(values);
    generated[app] = values;
  }
  await mkdir(join(qaDir, 'env'), { recursive: true });
  for (const [app, values] of Object.entries(generated)) await writeFile(join(qaDir, 'env', `${app}.env`), envText(values), { flag: 'wx', mode: 0o600 });
  await saveJson(join(qaDir, 'manifest.json'), { targetSet: config.id, kind: config.kind, services: config.services,
    databases: Object.fromEntries(services.map((name) => [name, config.databases[name].identity])),
    fixtures: 'NOT_CREATED', hostedSuite: 'NOT_RUN', deployedRisks: 'NOT_CHECKED' });
  console.log('Prepared isolated QA configuration in .qa. No database was opened, fixture created or service contacted.');
}

async function migrate() {
  for (const app of services) {
    const env = await appEnv(app);
    assertQaDatabaseTarget(env.DATABASE_ADMIN_URL || env.DATABASE_URL, { env });
    const database = decodeURIComponent(new URL(env.DATABASE_ADMIN_URL || env.DATABASE_URL).pathname.slice(1));
    const result = await execute(process.execPath, [join(root, 'apps', app, 'scripts', 'migrate.js'), 'run', `--confirm=${database}`], { cwd: join(root, 'apps', app), env });
    if (result.code) throw new Error(`QA migration failed for ${app}; no schema synchronization fallback is allowed`);
  }
}

async function fixtures() {
  await approvedFixtures();
  const lock = await open(join(qaDir, 'fixtures.lock'), 'wx', 0o600);
  try {
    for (const [app, phase] of [['identity-service', 'admin'], ['core-service', 'calendar'], ['identity-service', 'accounts']]) {
      const result = await execute(process.execPath, [join(root, 'scripts', 'qa', 'fixtures-worker.mjs'), phase], { env: await appEnv(app) });
      if (result.code) throw new Error(`QA fixture setup stopped at ${phase}; retain its state and fix the reported prerequisite`);
    }
  } finally { await lock.close(); await unlink(join(qaDir, 'fixtures.lock')); }
}

async function start() {
  const children = [];
  const { spawn } = await import('node:child_process');
  const environments = await Promise.all(apps.map(appEnv));
  if (environments.some((env) => env.QA_ENV_TYPE !== 'local')) throw new Error('qa:dev starts only the local QA set; hosted QA uses separate deployment projects');
  const stop = () => { for (const child of children) if (child.exitCode === null) child.kill('SIGTERM'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  for (const [index, app] of apps.entries()) {
    const env = environments[index];
    const serviceMap = JSON.parse(env.QA_SERVICES_JSON);
    const port = new URL(serviceMap[app]).port;
    const cwd = join(root, 'apps', app);
    const cli = createRequire(join(cwd, 'package.json')).resolve('next/dist/bin/next');
    const child = spawn(process.execPath, [cli, 'dev', '--hostname', '127.0.0.1', '--port', port], { cwd, env, shell: false, stdio: 'inherit' });
    children.push(child);
    child.once('error', stop);
    child.once('exit', stop);
  }
}

async function automation(name) {
  const suites = { smoke: 'smoke.cjs', transactions: 'transactions-list.cjs', public: 'public-services.cjs', completion: 'complete-manual-end.cjs' };
  if (!suites[name]) throw new Error('Select an existing QA suite: smoke, transactions, public or completion');
  const env = await appEnv('frontend');
  const identity = await appEnv('identity-service');
  const pack = await approvedFixtures();
  const state = await readJson(join(qaDir, 'fixture-state.json'));
  if (state.targetSet !== env.QA_TARGET_SET_ID || ['admin', 'calendar', 'accounts'].some((phase) => state.phases?.[phase] !== 'COMPLETED')) throw new Error('Complete the approved fixtures on this QA set before running the suite');
  const serviceMap = JSON.parse(env.QA_SERVICES_JSON);
  const out = join(qaDir, 'reports', `${Date.now()}-${name}`);
  await mkdir(out, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await execute(process.execPath, [join(root, 'apps', 'frontend', 'tests', 'e2e', suites[name])], {
    cwd: join(root, 'apps', 'frontend'), capture: true,
    env: { ...env, BASE_URL: serviceMap.frontend, ADMIN_EMAIL: pack.superAdmin.email, ADMIN_PASSWORD: identity.QA_FIXTURE_PASSWORD, OUT_DIR: out },
  });
  await writeFile(join(out, 'output.log'), redact(result.output, identity), { mode: 0o600 });
  await saveJson(join(out, 'report.json'), { suite: name, targetSet: env.QA_TARGET_SET_ID, environment: env.QA_ENV_TYPE,
    frontend: serviceMap.frontend, startedAt, finishedAt: new Date().toISOString(), exitCode: result.code,
    coverage: name === 'smoke' ? 'Existing smoke script, including its mocked-browser sections and configured full-system section' : 'Browser/API-mocked regression; does not prove hosted backend behavior',
    hostedFullSystemSuite: env.QA_ENV_TYPE === 'hosted' && name === 'smoke', result: result.code === 0 ? 'PASSED' : 'FAILED' });
  process.exitCode = result.code;
  console.log('QA run report saved under .qa/reports; raw credentials were redacted.');
}

try {
  const mode = process.argv[2];
  if (mode === 'init') await initialize();
  else if (mode === 'migrate') await migrate();
  else if (mode === 'fixtures') await fixtures();
  else if (mode === 'dev') await start();
  else if (mode === 'run') await automation(process.argv[3]);
  else throw new Error('Use init, migrate, fixtures, dev or run <suite>');
} catch (error) {
  console.error(String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]'));
  process.exitCode = 1;
}
