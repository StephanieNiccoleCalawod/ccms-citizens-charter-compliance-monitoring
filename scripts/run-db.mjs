import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ALL = ['oversight-service', 'identity-service', 'core-service', 'operations-service'];
// [services, script, ...arguments]. There is deliberately no all-services revert: revert one service at a time.
const commands = {
  'db:sync': [ALL, 'sync-db.js'], // local development only; refused for a hosted target
  migrate: [ALL, 'migrate.js', 'run'],
  'migrate:show': [ALL, 'migrate.js', 'show'],
  'migrate:check-baseline': [ALL, 'migrate.js', 'check-baseline'],
  // Interim explicit scripts (pre-TT1 fallback). Not needed once a database is tracked by the migrations.
  'migrate:sprint4': [['oversight-service', 'core-service', 'operations-service'], 'migrate-sprint4-critical.js'],
  'migrate:sprint5': [['identity-service', 'core-service', 'operations-service'], 'migrate-sprint5.js'],
};
const command = process.argv[2];
if (!commands[command]) throw new Error('Unknown database command');
const [apps, filename, ...args] = commands[command];
for (const app of apps) {
  console.log(`${command}: ${app}`);
  const cwd = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
  const result = spawnSync(process.execPath, ['--env-file-if-exists=.env.local', path.join('scripts', filename), ...args], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
