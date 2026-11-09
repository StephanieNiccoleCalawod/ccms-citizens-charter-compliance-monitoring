import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const commands = {
  'db:sync': ['oversight-service', 'identity-service', 'core-service', 'operations-service'],
  migrate: ['oversight-service', 'identity-service', 'core-service', 'operations-service'],
  'migrate:sprint4': ['oversight-service', 'core-service', 'operations-service'],
  'migrate:sprint5': ['identity-service', 'operations-service', 'core-service'],
};
const command = process.argv[2];
if (!commands[command]) throw new Error('Unknown database command');
const filename = command === 'db:sync' ? 'sync-db.js' : command === 'migrate' ? 'migrate.js' : command === 'migrate:sprint5' ? 'migrate-sprint5.js' : 'migrate-sprint4-critical.js';
for (const app of commands[command]) {
  console.log(`${command}: ${app}`);
  const cwd = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
  const result = spawnSync(process.execPath, ['--env-file-if-exists=.env.local', path.join('scripts', filename)], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
