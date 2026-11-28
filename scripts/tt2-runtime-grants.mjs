// Read-only privilege checks on the retained rehearsal copies, using the actual runtime role names.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const exec = promisify(execFile);
const dir = new URL('../../tt2-release-evidence-20261111/', import.meta.url);
const report = JSON.parse(await readFile(new URL('verification.json', dir), 'utf8'));
const inventory = JSON.parse(await readFile(new URL('targets.json', dir), 'utf8'));
const req = createRequire(new URL('../../tt1-operator-runtime/package.json', import.meta.url));
const neon = req('@neondatabase/serverless');
neon.neonConfig.webSocketConstructor = req('ws');
const result = [];
for (const service of ['operations', 'oversight']) {
  const local = parseEnv(await readFile(new URL(`../apps/${service}-service/.env.local`, import.meta.url), 'utf8'));
  const localUrl = new URL(local.DATABASE_URL);
  const entry = report.services.find((s) => s.service === service);
  const target = inventory.services.find((s) => s.service === service);
  const owner = target.databases.find((d) => d.name === entry.database).owner;
  const { stdout } = await exec(process.execPath, [`${process.env.APPDATA}/npm/node_modules/neon/dist/cli.js`, 'connection-string', entry.rehearsal.id, '--project-id', entry.projectId, '--database-name', entry.database, '--role-name', owner, '--no-pooled', '--no-analytics'], { timeout: 120000 });
  const url = new URL(stdout.trim());
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  const c = new neon.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const roles = (await c.query("SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = $1 OR rolname IN ('ccms_logs_writer','ccms_oversight_app','ccms_operations') ORDER BY rolname", [owner])).rows;
    const tables = service === 'operations' ? ['transactions', 'analytics_outbox'] : ['analytics_transactions', 'analytics_backfill_state'];
    for (const {rolname: role, rolcanlogin: canLogin} of roles) for (const table of tables) {
      const [privileges] = (await c.query("SELECT has_table_privilege($1, $2, 'SELECT') AS read, has_table_privilege($1, $2, 'INSERT') AS insert, has_table_privilege($1, $2, 'UPDATE') AS update", [role, table])).rows;
      result.push({ service, role, canLogin, table, localConfigurationIsDevelopment: ['127.0.0.1','localhost'].includes(localUrl.hostname), ...privileges });
    }
    await c.query('ROLLBACK');
  } finally { await c.end(); }
}
await writeFile(new URL('runtime-grants.json', dir), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
