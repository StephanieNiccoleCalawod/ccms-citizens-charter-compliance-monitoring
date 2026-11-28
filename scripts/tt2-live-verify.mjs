// Local operator only: existing credentials stay in memory; no fixtures or transaction writes.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { createDataSource, validateAnalyticsExportPage } from 'ccms-shared';
import { entities } from '../apps/oversight-service/src/lib/entities/index.js';
import { runAnalyticsBackfill } from '../apps/oversight-service/src/modules/analytics/backfill.js';
const dir = new URL('../../tt2-release-evidence-20261111/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const source = await read('targets.json');
const deployed = await read('deployment-verification.json');
if (!deployed.projects.every((p) => p.deployment?.state === 'READY' && p.domains?.every((d) => d.matches))) throw new Error('All production apps must be ready before live verification');
if (process.argv[2] === 'security') {
  const checks = [];
  const origins = { oversight: 'https://ccms-citizens-charter-compliance-mo.vercel.app', operations: 'https://ccms-citizens-charter-compliance-mo-six.vercel.app', gateway: 'https://ccms-citizens-charter-compliance-mo-eight.vercel.app' };
  const targets = [
    ['oversight', '/api/analytics-events', 'POST', 401],
    ['operations', '/api/transactions/analytics-export', 'GET', 401],
    ['oversight', '/api/jobs/analytics-backfill', 'GET', 401],
    ['operations', '/api/jobs/analytics-outbox', 'GET', 401],
    ...['logs', 'analytics', 'reports'].map((alias) => ['gateway', `/api/${alias}/analytics-events`, 'POST', 404]),
    ['gateway', '/api/operations/transactions/analytics-export', 'GET', 404],
    ['gateway', '/api/analytics/health', 'GET', 200],
    ['gateway', '/api/reports/health', 'GET', 200],
  ];
  for (const [service, path, method, expected] of targets) {
    const r = await fetch(`${origins[service]}${path}`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? '{"events":[]}' : undefined, signal: AbortSignal.timeout(30000), redirect: 'error' });
    checks.push({ service, path, method, status: r.status, expected });
    await r.body?.cancel().catch(() => {});
    if (r.status !== expected) throw new Error(`Live security check failed on ${path}: ${r.status}`);
  }
  const result = { checkedAt: new Date().toISOString(), commit: deployed.commit, checks, status: 'PASSED', productionBackfillExecuted: false, backfillNote: 'Existing local credentials are development-only. Historical production backfill is deferred to an authorized operator with the production service key/runtime connection; no development key was sent to production.' };
  await writeFile(new URL('live-analytics-verification.json', dir), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const env = parseEnv(await readFile(new URL('../apps/oversight-service/.env.local', import.meta.url), 'utf8'));
const opEnv = parseEnv(await readFile(new URL('../apps/operations-service/.env.local', import.meta.url), 'utf8'));
if (!env.SERVICE_KEY || env.SERVICE_KEY !== opEnv.SERVICE_KEY) throw new Error('Expected the existing shared operator service key in both service configurations');
const target = source.services.find((s) => s.service === 'oversight');
const parsed = new URL(env.DATABASE_URL);
const host = parsed.hostname.replace('-pooler.', '.');
if (host !== target.endpoints.find((e) => e.branchId === target.source.id)?.host || decodeURIComponent(parsed.pathname.slice(1)) !== 'ccms_oversight' || decodeURIComponent(parsed.username) !== 'ccms_logs_writer') throw new Error('The operator runtime URL does not match the verified Oversight source and restricted role');
const oversight = 'https://ccms-citizens-charter-compliance-mo.vercel.app';
const operations = 'https://ccms-citizens-charter-compliance-mo-six.vercel.app';
const gateway = 'https://ccms-citizens-charter-compliance-mo-eight.vercel.app';
const report = { checkedAt: new Date().toISOString(), commit: deployed.commit, probes: [], passes: [] };
async function probe(url, expected, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' });
  report.probes.push({ path: new URL(url).pathname, origin: new URL(url).origin, httpStatus: response.status, expected });
  if (response.status !== expected) throw new Error(`Unexpected status on ${new URL(url).pathname}: ${response.status}`);
  return response;
}
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"events":[]}' };
await probe(`${oversight}/api/analytics-events`, 401, post);
await probe(`${operations}/api/transactions/analytics-export`, 401);
const accepted = await (await probe(`${oversight}/api/analytics-events`, 200, { ...post, headers: { ...post.headers, 'x-service-key': env.SERVICE_KEY } })).json();
if (accepted.accepted !== 0 || accepted.applied !== 0) throw new Error('Unexpected empty-batch acknowledgement');
for (const alias of ['logs', 'analytics', 'reports']) await probe(`${gateway}/api/${alias}/analytics-events`, 404, { ...post, headers: { ...post.headers, 'x-service-key': env.SERVICE_KEY } });
await probe(`${gateway}/api/operations/transactions/analytics-export`, 404);
await probe(`${oversight}/api/jobs/analytics-backfill`, 401);
await probe(`${operations}/api/jobs/analytics-outbox`, 401);
const page = validateAnalyticsExportPage(await (await probe(`${operations}/api/transactions/analytics-export?limit=500`, 200, { headers: { 'x-service-key': env.SERVICE_KEY } })).json());
report.firstExportCount = page.items.length;
const req = createRequire(new URL('../../tt1-operator-runtime/package.json', import.meta.url));
const neon = req('@neondatabase/serverless');
neon.neonConfig.webSocketConstructor = req('ws');
neon.neonConfig.poolQueryViaFetch = false;
const ds = createDataSource({ url: env.DATABASE_URL, entities, synchronize: false });
ds.driver.postgres = neon;
await ds.initialize();
try {
  const [{ current_user: role }] = await ds.query('SELECT current_user');
  if (role !== 'ccms_logs_writer') throw new Error('Restricted runtime role required for the backfill');
  report.runtimeRole = role;
  const hash = async (table) => (await ds.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY transaction_id), '')) AS checksum FROM ${table} t`))[0];
  const auditHash = async () => (await ds.query("SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY audit_id), '')) AS checksum FROM audit_log t"))[0];
  const auditBefore = await auditHash();
  for (let pass = 0; pass < 2; pass++) {
    let summary;
    do {
      summary = await runAnalyticsBackfill({ dataSource: ds, operationsUrl: operations, serviceKey: env.SERVICE_KEY, maxPages: 20, timeBudgetMs: 20000, reset: pass === 0 && report.passes.length === 0 });
      report.passes.push({ pass: pass + 1, ...summary });
      if (!summary.ok || summary.skipped) throw new Error('Backfill did not finish successfully');
    } while (!summary.pass_completed);
    const after = await hash('analytics_transactions');
    if (pass === 0) report.afterFirstPass = after;
    else { report.afterSecondPass = after; if (JSON.stringify(after) !== JSON.stringify(report.afterFirstPass)) throw new Error('Backfill repeat changed the projection; review live concurrency before accepting'); }
  }
  report.auditUnchanged = JSON.stringify(await auditHash()) === JSON.stringify(auditBefore);
  if (!report.auditUnchanged) throw new Error('Audit log changed during the backfill; review concurrent activity');
  report.status = 'PASSED'; report.completedAt = new Date().toISOString();
  await writeFile(new URL('live-analytics-verification.json', dir), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, probes: report.probes.length, runtimeRole: report.runtimeRole, rows: report.afterSecondPass.count, repeatedBackfillUnchanged: true, auditUnchanged: true }));
} finally { await ds.destroy(); }
