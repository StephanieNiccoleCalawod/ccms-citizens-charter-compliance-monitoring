import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Use dev or start');
const apps = ['identity-service', 'oversight-service', 'core-service', 'operations-service', 'api-gateway', 'frontend'];
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
  }
}
for (const app of apps) {
  // Run the actual CLI, avoiding platform-specific shell quoting and npm grandchildren.
  const cwd = path.join(root, 'apps', app);
  const cli = createRequire(path.join(cwd, 'package.json')).resolve('next/dist/bin/next');
  const ports = { frontend: 3000, 'api-gateway': 8080, 'identity-service': 3001, 'oversight-service': 3002, 'core-service': 3003, 'operations-service': 3004 };
  const child = spawn(process.execPath, [cli, mode, '-p', String(ports[app])], {
    cwd, stdio: 'inherit', detached: process.platform !== 'win32',
    env: { ...process.env, DB_SYNCHRONIZE: 'false' },
  });
  children.push(child);
  child.on('error', (err) => { console.error(app, err.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) { console.error(`${app} exited (${code})`); stop(code || 1); } });
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
