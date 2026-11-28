// Local release helper: official CLI authentication; database credentials are parsed in memory only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = process.env.CCMS_RELEASE_EVIDENCE_DIR ?? fileURLToPath(new URL('../../tt1-hosted-integration-evidence-20261110/', import.meta.url));
const cli = 'C:/Users/Ideapad/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js';
const team = 'team_NVLuwTMLq3zpmizVbLPG11S2';
async function api(path, method = 'GET', body) {
  const args = [cli, 'api', `${path}${path.includes('?') ? '&' : '?'}teamId=${team}`, '--method', method, '--scope', 'ccmsdev', '--raw'];
  if (body) {
    const file = join(evidence, 'vercel-nonsecret-request.json');
    await mkdir(evidence, { recursive: true }); await writeFile(file, JSON.stringify(body)); args.push('--input', file);
  }
  try {
    const { stdout } = await exec(process.execPath, args, { cwd: root, timeout: 120000, maxBuffer: 8_000_000 });
    return JSON.parse(stdout);
  } catch (error) { throw new Error(`Vercel ${method} ${path.split('?')[0]} failed (${error.code ?? 'unknown'}); raw output withheld`); }
}
const targets = JSON.parse(await readFile(join(evidence, 'targets.json'), 'utf8')).services;
const projects = (await api('/v10/projects?limit=30')).projects.filter((p) => p.name.startsWith('ccms-citizens-charter-compliance-monitoring'));
if (projects.length !== 6) throw new Error(`Expected six CCMS projects, found ${projects.length}; no changes made`);
if (process.argv[2] === 'logs') {
  const report = JSON.parse(await readFile(join(evidence, 'deployment-verification.json'), 'utf8'));
  for (const item of report.projects.filter((p) => !process.argv[3] || p.rootDirectory.includes(process.argv[3]))) {
    const { stdout } = await exec(process.execPath, [cli, 'logs', `https://${item.deployment.url}`, '--scope', 'ccmsdev', '--project', item.id, '--level', 'error', '--since', '15m', '--limit', '30', '--json'], { cwd: root, timeout: 60000, maxBuffer: 2_000_000 });
    const events = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const summary = events.find((event) => event.type === 'summary');
    const logEvents = events.filter((event) => event.type === 'log');
    const sslModeWarnings = logEvents.filter((event) => String(event.data?.message).includes('SECURITY WARNING') && String(event.data?.message).includes('sslmode')).length;
    item.errorLogScan = { available: true, window: '15m', matchingEvents: summary?.recordsReturned,
      sslModeWarnings, otherErrorEvents: (summary?.recordsReturned ?? logEvents.length) - sslModeWarnings,
      warningReasons: events.filter((event) => event.type === 'warning').map((event) => event.reason),
      excludedIntervals: summary?.excludedIntervals };
    console.log(JSON.stringify({ project: item.rootDirectory, scan: item.errorLogScan,
      eventTypes: events.map((event) => ({ type: event.type, level: event.level, keys: Object.keys(event),
        data: event.data ? { keys: Object.keys(event.data), level: event.data.level, source: event.data.source,
          statusCode: event.data.statusCode, path: event.data.requestPath?.split('?')[0],
          warningKinds: ['DeprecationWarning', 'SECURITY WARNING', 'Warning:', 'sslmode', 'TypeError', 'Error:', 'ExperimentalWarning', 'MODULE_TYPELESS_PACKAGE_JSON', 'DEP0169', 'DEP0040', 'punycode', 'Buffer()', 'util._extend'].filter((text) => String(event.data.message).includes(text)),
          diagnosticCodes: String(event.data.message).match(/\b(?:ERR_[A-Z_0-9]+|DEP\d{4})\b/g),
          nestedKeys: event.data.message && typeof event.data.message === 'object' ? Object.keys(event.data.message) : undefined,
          signals: ['CRON_SECRET', 'DATABASE_UNAVAILABLE', 'INTERNAL_ERROR', 'does not exist', 'outbox', 'SERVICE_KEY', 'ECONNRESET', 'ECONNREFUSED', 'timeout', 'unauthorized', 'column', 'relation', 'permission', 'certificate', 'fetch failed'].filter((text) => JSON.stringify(event.data).toLowerCase().includes(text.toLowerCase())) } : undefined })) }));
  }
  await writeFile(join(evidence, 'deployment-verification.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
if (process.argv[2] === 'monitor') {
  const expected = process.env.TT1_DEPLOY_SHA;
  if (!/^[a-f0-9]{40}$/.test(expected ?? '')) throw new Error('Exact deployment commit required');
  const checks = await Promise.all(projects.map(async (project) => {
    const detail = await api(`/v9/projects/${project.id}`);
    if (detail.link?.productionBranch !== 'codebase-for-deployment' || detail.link?.repo !== 'ccms-citizens-charter-compliance-monitoring') throw new Error('Wrong deployment source');
    const latest = (await api(`/v6/deployments?projectId=${project.id}&target=production&limit=5`)).deployments;
    const deployment = latest.find((d) => d.meta?.githubCommitSha === expected);
    const item = { id: project.id, name: project.name, rootDirectory: detail.rootDirectory, expectedCommit: expected,
      deployment: deployment ? { id: deployment.uid ?? deployment.id, url: deployment.url, state: deployment.readyState ?? deployment.state, commit: deployment.meta?.githubCommitSha } : null };
    if (deployment && (deployment.readyState ?? deployment.state) === 'READY') {
      const domains = (await api(`/v9/projects/${project.id}/domains`)).domains.filter((d) => !d.redirect && !d.gitBranch && (!d.customEnvironmentId));
      item.domains = await Promise.all(domains.map(async (d) => {
        const alias = await api(`/v4/aliases/${d.name}`);
        return { domain: d.name, deploymentId: alias.deploymentId ?? alias.deployment?.id, matches: (alias.deploymentId ?? alias.deployment?.id) === (deployment.uid ?? deployment.id) };
      }));
      item.probes = [];
      for (const domain of item.domains.filter((d) => d.matches)) {
        const paths = detail.rootDirectory === 'apps/frontend' ? ['/', '/login', '/api/catalogue/public/services', '/api/identity/auth/jwks'] : ['/api/health'];
        if (detail.rootDirectory === 'apps/api-gateway') paths.push('/api/catalogue/health', '/api/identity/health', '/api/operations/health', '/api/logs/health', '/api/catalogue/public/services');
        for (const path of paths) {
          try {
            const r = await fetch(`https://${domain.domain}${path}`, { signal: AbortSignal.timeout(45000), redirect: 'follow' });
            const type = r.headers.get('content-type');
            let status;
            if (type?.includes('application/json')) { const json = await r.json(); status = json.status ?? json.error?.code; }
            else await r.arrayBuffer();
            item.probes.push({ domain: domain.domain, path, httpStatus: r.status, type, status });
          } catch { item.probes.push({ domain: domain.domain, path, error: 'request failed or timed out' }); }
        }
      }
      try {
        const { stdout } = await exec(process.execPath, [cli, 'logs', `https://${deployment.url}`, '--scope', 'ccmsdev', '--project', project.id, '--level', 'error', '--since', '15m', '--limit', '30', '--json'], { cwd: root, timeout: 60000, maxBuffer: 2_000_000 });
        const events = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
        const summary = events.find((event) => event.type === 'summary');
        item.errorLogScan = { available: true, window: '15m',
          matchingEvents: summary?.recordsReturned ?? events.filter((event) => !['warning', 'summary'].includes(event.type)).length,
          warningReasons: events.filter((event) => event.type === 'warning').map((event) => event.reason),
          excludedIntervals: summary?.excludedIntervals };
      } catch { item.errorLogScan = { available: false, note: 'Runtime error logs could not be queried; health probes recorded separately.' }; }
    }
    return item;
  }));
  const report = { checkedAt: new Date().toISOString(), commit: expected, projects: checks };
  await writeFile(join(evidence, 'deployment-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
const result = { checkedAt: new Date().toISOString(), teamId: team, projects: [] };
for (const project of projects) {
  const detail = await api(`/v9/projects/${project.id}`);
  if (detail.link?.productionBranch !== 'codebase-for-deployment' || detail.link?.repo !== 'ccms-citizens-charter-compliance-monitoring') {
    throw new Error(`Unexpected Git deployment source for ${project.name}; stop before changes`);
  }
  const service = targets.find((s) => detail.rootDirectory === `apps/${s.service}-service`);
  const item = { id: project.id, name: project.name, rootDirectory: detail.rootDirectory,
    productionBranch: detail.link.productionBranch, currentProduction: detail.targets?.production ? {
      id: detail.targets.production.id, url: detail.targets.production.url, readyState: detail.targets.production.readyState,
      commit: detail.targets.production.meta?.githubCommitSha,
    } : null, service: service?.service };
  const ready = (await api(`/v6/deployments?projectId=${project.id}&target=production&state=READY&limit=1`)).deployments?.[0];
  if (ready) item.rollbackDeployment = { id: ready.uid ?? ready.id, url: ready.url, commit: ready.meta?.githubCommitSha };
  if (service) {
    let envs = (await api(`/v10/projects/${project.id}/env?decrypt=false`)).envs;
    const dbEnv = envs.find((e) => e.key === 'DATABASE_URL' && e.target?.includes('production'));
    if (!dbEnv) throw new Error(`Production DATABASE_URL is missing for ${service.service}`);
    const secret = await api(`/v1/projects/${project.id}/env/${dbEnv.id}`);
    const connectionValue = secret.value ?? secret.env?.value;
    if (typeof connectionValue === 'string' && /^postgres(?:ql)?:\/\//.test(connectionValue)) {
      const parsed = new URL(connectionValue);
      const host = parsed.hostname.replace('-pooler.', '.');
      const expectedHost = service.endpoints.find((e) => e.branchId === service.source.id)?.host;
      if (host !== expectedHost || decodeURIComponent(parsed.pathname.slice(1)) !== `ccms_${service.service}`) {
        throw new Error(`Deployment database binding does not match verified Neon source for ${service.service}`);
      }
      item.databaseBindingVerified = true;
      item.databaseHost = host; item.databaseName = decodeURIComponent(parsed.pathname.slice(1));
    } else {
      item.databaseBindingVerified = false;
      item.databaseBindingNote = 'Existing sensitive DATABASE_URL cannot be revealed by Vercel; preserved unchanged. Neon source mapping is recorded separately.';
    }
    item.guards = {};
    for (const [key, value] of [['DB_TARGET', 'hosted'], ['DB_SYNCHRONIZE', 'false']]) {
      let existing = envs.find((e) => e.key === key && e.target?.includes('production'));
      let acknowledged = false;
      if (['configure', 'configure-tt2'].includes(process.argv[2])) {
        if (existing) await api(`/v9/projects/${project.id}/env/${existing.id}`, 'PATCH', { value });
        else await api(`/v10/projects/${project.id}/env`, 'POST', { key, value, target: ['production'], type: 'plain', comment: 'TT1: hosted database changes use numbered migrations only' });
        acknowledged = true;
        envs = (await api(`/v10/projects/${project.id}/env?decrypt=false`)).envs;
        existing = envs.find((e) => e.key === key && e.target?.includes('production'));
      }
      if (existing) {
        const setting = existing.type === 'plain' ? existing : await api(`/v1/projects/${project.id}/env/${existing.id}`);
        item.guards[key] = { configured: setting.value === value || acknowledged, targets: existing.target,
          verification: setting.value === value ? 'read-back matched' : acknowledged ? 'Vercel acknowledged the explicit value update; existing secret type preserved' : 'secret value cannot be read back' };
      } else item.guards[key] = { configured: false };
    }
    if (service.service === 'oversight' && process.argv[2] === 'configure-tt2') {
      const key = 'OPERATIONS_SERVICE_URL';
      const value = 'https://ccms-citizens-charter-compliance-mo-six.vercel.app';
      const operations = projects.find((p) => p.id === 'prj_2XPdiulSWvdc0jZ3s4mSkpfAWSzo');
      if (!operations) throw new Error('Verified Operations project missing');
      const existing = envs.find((e) => e.key === key && e.target?.includes('production'));
      if (existing && (existing.target.length !== 1 || existing.gitBranch)) throw new Error('Refusing to change a shared or branch-specific Operations URL');
      if (existing) await api(`/v9/projects/${project.id}/env/${existing.id}`, 'PATCH', { value });
      else await api(`/v10/projects/${project.id}/env`, 'POST', { key, value, target: ['production'], type: 'plain', comment: 'TT2: direct authenticated Operations export for the analytics backfill' });
      item.operationsExportConfigured = true;
    }
  }
  result.projects.push(item);
  await writeFile(join(evidence, 'vercel-release.json'), JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(item));
}
