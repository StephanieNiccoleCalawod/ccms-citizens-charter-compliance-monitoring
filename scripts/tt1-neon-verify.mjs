// Operator workflow: inspect targets first; all database SQL is read-only unless a verified rehearsal URL is used.
// Neon connection strings are captured in memory and never printed or persisted.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { schemaFingerprint, compareBaseline, createDataSource, runMigrationCli } from 'ccms-shared';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const evidenceDir = process.env.TT1_EVIDENCE_DIR ?? fileURLToPath(new URL('../../tt1-hosted-evidence-20261110/', import.meta.url));
const runTag = process.env.TT1_RUN_TAG ?? '20261110';
let pgDriver = pg;
if (process.env.TT1_NEON_WEBSOCKET === '1') {
  const operatorRequire = createRequire(new URL('../../tt1-operator-runtime/package.json', import.meta.url));
  pgDriver = operatorRequire('@neondatabase/serverless');
  pgDriver.neonConfig.webSocketConstructor = operatorRequire('ws');
  pgDriver.neonConfig.poolQueryViaFetch = false;
}
function migrationSource(options) {
  const source = createDataSource(options);
  // Operator-only transport: the official pg-compatible Neon driver preserves the same session,
  // advisory lock and transactions over verified TLS WebSockets. Application runtime is unchanged.
  if (pgDriver !== pg) source.driver.postgres = pgDriver;
  return source;
}
const cli = join(process.env.APPDATA, 'npm/node_modules/neon/dist/cli.js');
const projects = {
  oversight: 'billowing-waterfall-56759322', identity: 'odd-lake-68958899',
  core: 'sweet-hat-38646949', operations: 'morning-wind-47114114',
};
const releaseServices = process.env.CCMS_RELEASE_SERVICES ? process.env.CCMS_RELEASE_SERVICES.split(',') : ['oversight', 'identity', 'core', 'operations'];
if (!releaseServices.length || new Set(releaseServices).size !== releaseServices.length || releaseServices.some((s) => !projects[s])) throw new Error('Invalid release service list');
async function neon(args) {
  try {
    const { stdout } = await exec(process.execPath, [cli, ...args, '--output', 'json', '--no-analytics'], { cwd: root, timeout: 120000, maxBuffer: 5_000_000 });
    // connection-string prints a bare URL even when --output=json is selected.
    return args[0] === 'connection-string' ? stdout.trim() : JSON.parse(stdout);
  } catch (error) {
    // CLI errors can contain sensitive output. Do not forward stdout/stderr.
    throw new Error(`Neon command failed (${args[0]} ${args[1] ?? ''}; code ${error.code ?? 'unknown'}). No credentials printed.`);
  }
}
async function save(name, value) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, name), JSON.stringify(value, null, 2) + '\n');
}

async function inspect() {
  const services = await Promise.all(Object.entries(projects).filter(([service]) => releaseServices.includes(service)).map(async ([service, projectId]) => {
    const [branchResult, endpointResult] = await Promise.all([
      neon(['api', `/projects/${projectId}/branches`]),
      neon(['api', `/projects/${projectId}/endpoints`]),
    ]);
    const branches = branchResult.branches;
    const source = branches.find((b) => b.default);
    if (!source) throw new Error(`No unambiguous default branch for ${service}`);
    const databaseResult = await neon(['api', `/projects/${projectId}/branches/${source.id}/databases`]);
    return {
      service, projectId,
      branches: branches.map(({ id, name, default: isDefault }) => ({ id, name, isDefault })),
      source: { id: source.id, name: source.name },
      endpoints: endpointResult.endpoints.map(({ id, branch_id, host }) => ({ id, branchId: branch_id, host })),
      databases: databaseResult.databases.map(({ name, owner_name }) => ({ name, owner: owner_name })),
    };
  }));
  await save('targets.json', { inspectedAt: new Date().toISOString(), services });
  console.log(JSON.stringify(services, null, 2));
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function connection(target, branchId) {
  const value = await neon(['connection-string', branchId, '--project-id', target.projectId,
    '--database-name', target.database.name, '--role-name', target.database.owner, '--no-pooled']);
  const url = typeof value === 'string' ? value : value.uri ?? value.connection_string ?? value.connectionString;
  if (!url || !new URL(url).hostname.endsWith('.neon.tech') || new URL(url).hostname.includes('-pooler.')) {
    throw new Error(`No direct Neon URL returned for ${target.service}`);
  }
  return url;
}
async function snapshot(url, columnsFrom) {
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(key);
  const client = new pgDriver.Client({ connectionString: parsed.toString(), ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 20000, application_name: 'ccms-tt1-readonly-verification' });
  await client.connect();
  try {
    await client.query("SET statement_timeout='60s'; SET timezone='UTC'");
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [{ database, version, captured_at }] = (await client.query(
      'SELECT current_database() AS database, version() AS version, now() AS captured_at')).rows;
    const schema = await schemaFingerprint({ query: async (sql, args) => (await client.query(sql, args)).rows });
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'typeorm_migrations' ORDER BY tablename")).rows;
    const data = {};
    for (const { tablename } of tables) {
      if (columnsFrom && !(`table:${tablename}` in columnsFrom)) continue;
      const columns = columnsFrom && Object.keys(columnsFrom).filter((key) => key.startsWith(`column:${tablename}.`))
        .map((key) => quote(key.slice(`column:${tablename}.`.length))).sort();
      const from = columns ? `(SELECT ${columns.join(', ')} FROM public.${quote(tablename)})` : `public.${quote(tablename)}`;
      const [row] = (await client.query(`SELECT count(*)::text AS count,
        md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS checksum
        FROM (SELECT md5(row_to_json(t)::text) AS h FROM ${from} t) rows`)).rows;
      data[tablename] = row;
    }
    const tracking = await client.query("SELECT to_regclass('public.typeorm_migrations') IS NOT NULL AS exists");
    const migrations = tracking.rows[0].exists ? (await client.query('SELECT name FROM public.typeorm_migrations ORDER BY id')).rows.map((r) => r.name) : [];
    await client.query('COMMIT');
    return { database, version, capturedAt: captured_at, schema, schemaHash: digest(schema), data, dataHash: digest(data), migrations };
  } finally {
    await client.end();
  }
}

async function rehearse() {
  const report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(join(evidenceDir, 'targets.json'), 'utf8'));
  const checkpoint = () => save('verification.json', report);
  for (const entry of report.services) {
    if (!entry.backupVerified || !entry.rehearsal || entry.status === 'REHEARSAL_PASSED_PRODUCTION_UNCHANGED') continue;
    const item = inventory.services.find((s) => s.service === entry.service);
    const target = { ...item, database: item.databases.find((d) => d.name === entry.database) };
    const branchResult = await neon(['api', `/projects/${entry.projectId}/branches/${entry.rehearsal.id}`]);
    const branch = branchResult.branch ?? branchResult;
    if (branch.parent_id !== entry.backup.id || branch.id === entry.source.id || branch.id === entry.backup.id ||
        !branch.name.startsWith(`rehearsal-tt1-${entry.service}-`)) throw new Error('Rehearsal branch identity verification failed');
    const endpoints = (await neon(['api', `/projects/${entry.projectId}/branches/${entry.rehearsal.id}/endpoints`])).endpoints;
    const url = await connection(target, entry.rehearsal.id);
    if (!endpoints.some((endpoint) => endpoint.host === new URL(url).hostname && endpoint.branch_id === entry.rehearsal.id)) {
      throw new Error('Connection does not belong to the rehearsal endpoint');
    }
    const before = await snapshot(url);
    const backupUrl = await connection(target, entry.backup.id);
    const backupBefore = await snapshot(backupUrl);
    if (backupBefore.dataHash !== entry.backupSnapshot.dataHash || backupBefore.schemaHash !== before.schemaHash ||
        backupBefore.dataHash !== before.dataHash) throw new Error('Rehearsal or retained backup changed since verification');
    const { baseline, migrations } = await import(`../apps/${entry.service}-service/migrations/index.js`);
    const diff = compareBaseline(baseline, before.schema);
    entry.initialBaselineDiff ??= entry.baselineDiff;
    entry.baselineDiff = diff;
    entry.normalizedBackupSnapshot = backupBefore;
    entry.comparisonNote = 'Validated PostgreSQL 18 table NOT NULL catalog entries are represented by column nullability; unvalidated entries still block adoption.';
    if (diff.missing.length || diff.changed.length) { entry.status = 'BASELINE_MISMATCH_NO_ADOPTION'; entry.baselineDiff = diff; await checkpoint(); continue; }
    const originalData = await snapshot(url, before.schema);
    const { entities } = await import(`../apps/${entry.service}-service/src/lib/entities/index.js`);
    entry.rehearsalLog = [];
    const run = async (argv) => {
      const code = await runMigrationCli({ service: entry.service, argv,
        env: { DATABASE_ADMIN_URL: url, DB_TARGET: 'hosted' }, baseline,
        createSource: (connectionUrl) => migrationSource({ url: connectionUrl, entities, migrations, synchronize: false }),
        log: (line) => entry.rehearsalLog.push(line),
      });
      await checkpoint();
      if (code !== 0) throw new Error(`${entry.service} rehearsal command failed`);
    };
    console.log(`${entry.service}: adopting baseline on verified rehearsal branch only.`);
    await run(['baseline', `--confirm=${entry.database}`, ...(diff.unexpected.length ? ['--accept-extra'] : [])]);
    const adopted = await snapshot(url);
    if (adopted.schemaHash !== before.schemaHash || adopted.dataHash !== before.dataHash) throw new Error('Baseline adoption changed business schema or records');
    entry.baselineAdoptionVerified = true;
    await run(['show']);
    await run(['run', `--confirm=${entry.database}`]);
    await run(['show']);
    entry.rehearsalAfter = await snapshot(url);
    const afterOriginalData = await snapshot(url, before.schema);
    entry.originalRecordsPreserved = originalData.dataHash === afterOriginalData.dataHash;
    const backupAfter = await snapshot(backupUrl);
    entry.retainedBackupUnchanged = backupAfter.schemaHash === backupBefore.schemaHash && backupAfter.dataHash === backupBefore.dataHash;
    if (!entry.originalRecordsPreserved || !entry.retainedBackupUnchanged) throw new Error('Rehearsal preservation checks failed');
    entry.status = 'REHEARSAL_PASSED_PRODUCTION_UNCHANGED';
    entry.rehearsalCompletedAt = new Date().toISOString();
    await checkpoint();
    console.log(`${entry.service}: rehearsal passed; backup and production were not migrated.`);
  }
  await checkpoint();
}
async function createCopy(target, parentId, kind) {
  const name = `${kind}-tt1-${target.service}-${runTag}`;
  const found = (await neon(['api', `/projects/${target.projectId}/branches`])).branches.find((b) => b.name === name);
  if (found) {
    if (found.parent_id !== parentId) throw new Error(`Existing ${name} has the wrong parent`);
    return { id: found.id, name: found.name, parentId: found.parent_id, createdAt: found.created_at,
      parentLsn: found.parent_lsn, expiresAt: found.expires_at };
  }
  const args = ['branches', 'create', '--project-id', target.projectId, '--parent', parentId,
    '--name', name, '--no-secrets'];
  if (kind === 'rehearsal') args.push('--expires-at', new Date(Date.now() + 7 * 86400000).toISOString());
  const result = await neon(args);
  const branch = result.branch ?? (result.id ? result : (await neon(['api', `/projects/${target.projectId}/branches`])).branches.find((b) => b.name === name));
  if (!branch.id || branch.parent_id !== parentId) throw new Error(`Unexpected parent for ${target.service} ${kind}`);
  return { id: branch.id, name: branch.name, parentId: branch.parent_id, createdAt: branch.created_at,
    parentLsn: branch.parent_lsn, expiresAt: branch.expires_at };
}
async function backup() {
  const inventory = JSON.parse(await readFile(join(evidenceDir, 'targets.json'), 'utf8'));
  let report;
  try { report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8')); }
  catch { report = { startedAt: new Date().toISOString(), sourceSqlReadOnly: true, productionMigrationsRun: false, services: [] }; }
  const checkpoint = () => save('verification.json', report);
  for (const item of inventory.services) {
    const database = item.databases.find((d) => d.name === `ccms_${item.service}`);
    if (!database) throw new Error(`Missing expected database for ${item.service}`);
    const target = { ...item, database };
    let entry = report.services.find((s) => s.service === target.service);
    if (!entry) { entry = { service: target.service, projectId: target.projectId, database: database.name, source: target.source }; report.services.push(entry); }
    console.log(`${target.service}: reading source schema and record checksums (read-only).`);
    const sourceUrl = await connection(target, target.source.id);
    if (!entry.backup) { entry.sourceBefore = await snapshot(sourceUrl); await checkpoint(); }
    if (!entry.backup) { entry.backup = await createCopy(target, target.source.id, 'pre'); await checkpoint(); }
    console.log(`${target.service}: backup ${entry.backup.id} created; verifying its contents.`);
    const backupUrl = await connection(target, entry.backup.id);
    entry.backupSnapshot = await snapshot(backupUrl);
    entry.sourceAfter = await snapshot(sourceUrl);
    entry.sourceStable = entry.sourceBefore.schemaHash === entry.sourceAfter.schemaHash && entry.sourceBefore.dataHash === entry.sourceAfter.dataHash;
    entry.backupVerified = entry.sourceStable && entry.sourceBefore.schemaHash === entry.backupSnapshot.schemaHash && entry.sourceBefore.dataHash === entry.backupSnapshot.dataHash;
    await checkpoint();
    if (!entry.backupVerified) { entry.status = 'BACKUP_COMPARISON_REQUIRES_REVIEW'; await checkpoint(); console.log(`${target.service}: comparison differs; no rehearsal writes attempted.`); continue; }
    if (!entry.rehearsal) { entry.rehearsal = await createCopy(target, entry.backup.id, 'rehearsal'); await checkpoint(); }
    const rehearsalUrl = await connection(target, entry.rehearsal.id);
    entry.rehearsalBefore = await snapshot(rehearsalUrl);
    if (entry.rehearsalBefore.schemaHash !== entry.backupSnapshot.schemaHash || entry.rehearsalBefore.dataHash !== entry.backupSnapshot.dataHash) {
      throw new Error(`Rehearsal differs from verified backup for ${target.service}`);
    }
    const { baseline } = await import(`../apps/${target.service}-service/migrations/index.js`);
    entry.baselineDiff = compareBaseline(baseline, entry.rehearsalBefore.schema);
    entry.status = entry.baselineDiff.missing.length || entry.baselineDiff.changed.length ? 'BASELINE_MISMATCH_NO_ADOPTION' : 'BASELINE_COMPATIBLE_READY_FOR_REHEARSAL';
    await checkpoint();
    console.log(`${target.service}: ${entry.status}; missing=${entry.baselineDiff.missing.length}, changed=${entry.baselineDiff.changed.length}, extra=${entry.baselineDiff.unexpected.length}.`);
  }
  report.completedInspectionAt = new Date().toISOString();
  await checkpoint();
  console.log(`Evidence saved outside the repository: ${evidenceDir}`);
}

async function refreshRehearsals() {
  const report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
  await save('verification-before-release-rehearsal.json', report);
  const inventory = JSON.parse(await readFile(join(evidenceDir, 'targets.json'), 'utf8'));
  for (const entry of report.services) {
    if (!entry.backupVerified || entry.status !== 'REHEARSAL_PASSED_PRODUCTION_UNCHANGED') throw new Error('Existing verified backup and rehearsal required');
    const item = inventory.services.find((s) => s.service === entry.service);
    const fresh = await createCopy(item, entry.backup.id, 'rehearsal');
    if (fresh.id === entry.rehearsal.id) throw new Error('Use a new release run tag for fresh rehearsals');
    entry.previousRehearsal = entry.rehearsal;
    entry.rehearsal = fresh;
    entry.status = 'BASELINE_COMPATIBLE_READY_FOR_REHEARSAL';
    await save('verification.json', report);
    console.log(`${entry.service}: fresh release rehearsal copy created from retained backup.`);
  }
}
async function production(write = false) {
  const report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(join(evidenceDir, 'targets.json'), 'utf8'));
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  const { stdout: dirty } = await exec('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root });
  if (write && dirty.trim()) throw new Error('Commit tracked changes before production execution');
  if (write) {
    if (process.env.TT1_RELEASE_SHA !== head.trim()) throw new Error('Exact tested release SHA required');
    const { stdout } = await exec(process.execPath, [join(root, 'scripts/tt1-github-release.mjs'), 'status', process.env.CCMS_RELEASE_PR ?? '1'], { cwd: root, timeout: 60000 });
    const github = JSON.parse(stdout);
    if (github.sha !== head.trim() || github.state !== 'open' || github.mergeable === false ||
        !github.checks.some((c) => c.name === 'checks') || github.checks.some((c) => c.status !== 'completed' || c.conclusion !== 'success') ||
        github.statuses.length !== 6 || github.statuses.some((s) => s.state !== 'success')) throw new Error('All current GitHub and Vercel checks must pass before production');
    // A direct descendant of the current deployment commit has no possible merge conflict,
    // even while GitHub's asynchronous mergeability calculation returns null.
    await exec('git', ['merge-base', '--is-ancestor', github.baseSha, head.trim()], { cwd: root });
    const vercel = JSON.parse(await readFile(join(evidenceDir, 'vercel-release.json'), 'utf8'));
    const backends = vercel.projects.filter((p) => p.service);
    if (backends.length !== releaseServices.length || backends.some((p) => !p.guards.DB_TARGET.configured || !p.guards.DB_SYNCHRONIZE.configured)) throw new Error('Hosted database safeguards required for every release service');
    await save('release-checks.json', { checkedAt: new Date().toISOString(), commit: head.trim(), github, vercel });
  }
  const prepared = [];
  // Preflight every service before the first production write.
  for (const service of releaseServices) {
    console.log(`${service}: verifying branch metadata and read-only database access.`);
    const entry = report.services.find((s) => s.service === service);
    if (!entry?.backupVerified || entry.status !== 'REHEARSAL_PASSED_PRODUCTION_UNCHANGED' || !entry.originalRecordsPreserved) throw new Error(`Verified rehearsal missing for ${service}`);
    const item = inventory.services.find((s) => s.service === service);
    if (projects[service] !== entry.projectId || item.source.id !== entry.source.id) throw new Error('Production project identity mismatch');
    const target = { ...item, database: item.databases.find((d) => d.name === entry.database) };
    const sourceBranch = (await neon(['api', `/projects/${entry.projectId}/branches/${entry.source.id}`])).branch;
    const backupBranch = (await neon(['api', `/projects/${entry.projectId}/branches/${entry.backup.id}`])).branch;
    if (sourceBranch.id !== entry.source.id || !sourceBranch.default || backupBranch.parent_id !== sourceBranch.id || backupBranch.expires_at) throw new Error('Source or retained backup branch identity invalid');
    const url = await connection(target, entry.source.id);
    const endpoints = (await neon(['api', `/projects/${entry.projectId}/branches/${entry.source.id}/endpoints`])).endpoints;
    if (!endpoints.some((e) => e.branch_id === entry.source.id && e.host === new URL(url).hostname)) throw new Error('Production endpoint mismatch');
    console.log(`${service}: branch identity verified; reading production snapshot.`);
    const before = await snapshot(url);
    const retained = await snapshot(await connection(target, entry.backup.id));
    const expected = entry.normalizedBackupSnapshot ?? entry.backupSnapshot;
    if (retained.schemaHash !== expected.schemaHash || retained.dataHash !== expected.dataHash || before.schemaHash !== retained.schemaHash || before.dataHash !== retained.dataHash) throw new Error(`${service}: live database or backup changed; create and rehearse a fresh backup before release`);
    const { baseline, migrations } = await import(`../apps/${service}-service/migrations/index.js`);
    const diff = compareBaseline(baseline, before.schema);
    if (diff.missing.length || diff.changed.length) throw new Error(`${service}: baseline no longer compatible`);
    const { entities } = await import(`../apps/${service}-service/src/lib/entities/index.js`);
    const original = await snapshot(url, before.schema);
    prepared.push({ service, entry, url, before, original, baseline, migrations, entities, diff });
    console.log(`${service}: production source matches retained backup; preflight passed.`);
  }
  if (!write) return;
  const release = { startedAt: new Date().toISOString(), commit: head.trim(), actor: 'Codex executing the user-authorized release', services: [] };
  await save('production-release.json', release);
  for (const p of prepared) {
    const item = { service: p.service, database: p.entry.database, backup: p.entry.backup, source: p.entry.source, startedAt: new Date().toISOString(), log: [] };
    release.services.push(item); await save('production-release.json', release);
    // Stop if another writer changed records after the all-service preflight.
    const now = await snapshot(p.url);
    if (now.schemaHash !== p.before.schemaHash || now.dataHash !== p.before.dataHash) throw new Error(`${p.service}: changed after preflight; no migration attempted for this service`);
    const run = async (argv) => {
      const code = await runMigrationCli({ service: p.service, argv, env: { DATABASE_ADMIN_URL: p.url, DB_TARGET: 'hosted' }, baseline: p.baseline,
        createSource: (url) => migrationSource({ url, entities: p.entities, migrations: p.migrations, synchronize: false }), log: (line) => item.log.push(line) });
      await save('production-release.json', release);
      if (code !== 0) throw new Error(`${p.service}: production migration command failed; inspect private release evidence`);
    };
    await run(['baseline', `--confirm=${p.entry.database}`, ...(p.diff.unexpected.length ? ['--accept-extra'] : [])]);
    const adopted = await snapshot(p.url);
    if (adopted.schemaHash !== p.before.schemaHash || adopted.dataHash !== p.before.dataHash) throw new Error(`${p.service}: baseline preservation check failed`);
    item.baselineAdoptionVerified = true;
    await run(['run', `--confirm=${p.entry.database}`]); await run(['show']);
    item.after = await snapshot(p.url);
    item.originalRecordsPreserved = (await snapshot(p.url, p.before.schema)).dataHash === p.original.dataHash;
    const expectedNames = p.migrations.map((M) => new M().name ?? M.name);
    if (!item.originalRecordsPreserved || expectedNames.some((name) => !item.after.migrations.includes(name))) throw new Error(`${p.service}: post-migration verification failed`);
    item.completedAt = new Date().toISOString(); item.status = 'PASSED';
    await save('production-release.json', release);
    console.log(`${p.service}: production migrations applied; original records preserved.`);
  }
  release.completedAt = new Date().toISOString(); release.status = 'ALL_FOUR_PASSED';
  await save('production-release.json', release);
}

try {
  if (process.argv[2] === 'inspect') await inspect();
  else if (process.argv[2] === 'backup') await backup();
  else if (process.argv[2] === 'rehearse') await rehearse();
  else if (process.argv[2] === 'preflight') await production(false);
  else if (process.argv[2] === 'production') await production(true);
  else if (process.argv[2] === 'refresh-rehearsals') await refreshRehearsals();
  else throw new Error('Use inspect, backup or rehearse.');
} catch (error) {
  // Never emit arbitrary errors from tools that may hold credentials or record values.
  console.error(`Verification stopped safely: ${String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted connection]')}`);
  process.exitCode = 1;
}
