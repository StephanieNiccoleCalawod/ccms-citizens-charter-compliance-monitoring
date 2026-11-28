// Backend-only TT3 verification. Never loads service .env files or live database URLs.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'docs/evidence/tt3-local');
mkdirSync(directory, { recursive: true });
const log = [];
const emit = (message) => { log.push(message); console.log(message); };
const command = (exe, args, timeout, allowFailure = false) => new Promise((resolve, reject) => {
  emit(`Running: ${exe} ${args.join(' ')}`);
  const child = spawn(exe, args, {
    cwd: root,
    env: { ...process.env, TEST_PG_URL: 'postgres://postgres:postgres@127.0.0.1:55432/postgres' },
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    const text = chunk.toString();
    log.push(text);
    process.stdout.write(text);
  });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (timedOut) reject(new Error(`${exe} exceeded ${timeout / 1000}s; see the preceding output`));
    else if (code !== 0 && !allowFailure) reject(new Error(`${exe} failed (${code}); verification did not pass`));
    else resolve(code);
  });
});

try {
  emit(`TT3 backend verification: ${new Date().toISOString()}`);
  // Image download/container startup has its own budget; do not consume the
  // database readiness budget while Docker is still preparing the container.
  await command('docker', ['compose', '-f', 'compose.test.yml', 'up', '-d'], 180_000);
  let ready = false;
  for (let attempt = 1; attempt <= 30; attempt++) {
    emit(`PostgreSQL readiness check ${attempt}/30`);
    const code = await command('docker', ['compose', '-f', 'compose.test.yml', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'postgres'], 10_000, true);
    if (code === 0) { ready = true; break; }
    await delay(2000);
  }
  if (!ready) {
    await command('docker', ['compose', '-f', 'compose.test.yml', 'logs', '--tail', '60', 'postgres'], 15_000, true);
    throw new Error('PostgreSQL did not become ready; inspect the container log above');
  }
  const client = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:55432/postgres', connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user');
    if (!rows[0]?.allowed) throw new Error('Test server must permit creation of synthetic test databases');
    emit('PASS: PostgreSQL reachable and test database creation permitted');
  } finally { await client.end().catch(() => {}); }
  const suites = [
    'apps/core-service/test/calendar-sync.test.js',
    'apps/core-service/test/fms-key-rejection.test.js',
    'apps/operations-service/test/cc040-queue-wait.test.js',
    'apps/operations-service/test/complete.test.js',
    'apps/operations-service/test/cc045-receipts.test.js',
    'apps/operations-service/test/cc049-acknowledgement.test.js',
    'apps/api-gateway/test/gateway.test.js',
    'apps/api-gateway/test/tt3-write-failures.test.js',
  ];
  const failures = [];
  for (const [index, suite] of suites.entries()) {
    emit(`Suite ${index + 1}/${suites.length}: ${suite} (independent 180s limit)`);
    const started = Date.now();
    try {
      await command(process.execPath, ['--test', '--test-concurrency=1', suite], 180_000);
      emit(`PASS suite: ${suite} (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      failures.push(suite);
      emit(`FAILED OR INCOMPLETE suite: ${suite}: ${error.message}`);
      emit('Continuing to the remaining suites; the final result will still be a failure.');
    }
    writeFileSync(join(directory, 'latest.log'), log.join('\n') + '\n');
  }
  if (failures.length) throw new Error(`Incomplete or failed suites: ${failures.join(', ')}`);
  emit('PASS: selected TT3 backend suites completed, including ticket-issuance outage, acknowledgement delivery, and gateway write-failure checks. Review evidence against TT3 acceptance criteria before closure.');
} catch (error) {
  emit(`BLOCKED OR FAILED: ${error.message}`);
  if (!/Incomplete or failed suites:/.test(error.message)) {
    emit('For Docker startup problems, check: docker compose -f compose.test.yml ps --all');
    emit('For PostgreSQL startup problems, check: docker compose -f compose.test.yml logs --tail 60 postgres');
  }
  if (/EACCES|access.*denied/i.test(error.message)) emit('This execution context denied access. Run npm run test:tt3 in your own PowerShell terminal.');
  process.exitCode = 1;
} finally {
  writeFileSync(join(directory, 'latest.log'), log.join('\n') + '\n');
}
