import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { describe, it } from 'node:test';
import { assertQaDatabaseTarget, assertQaServiceTargets } from '../src/qa.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apps = ['identity-service', 'core-service', 'operations-service', 'oversight-service', 'api-gateway', 'frontend'];

async function sandbox() {
  const dir = await mkdtemp(join(root, '.run-tt56-qa-init-'));
  await mkdir(join(dir, 'scripts', 'qa'), { recursive: true });
  await mkdir(join(dir, 'qa'));
  for (const name of ['common.mjs', 'manage.mjs']) await copyFile(join(root, 'scripts', 'qa', name), join(dir, 'scripts', 'qa', name));
  for (const app of apps) {
    await mkdir(join(dir, 'apps', app), { recursive: true });
    await copyFile(join(root, 'apps', app, '.env.example'), join(dir, 'apps', app, '.env.example'));
  }
  await writeFile(join(dir, 'apps', 'frontend', '.env.local'), 'UNRELATED_PROVIDER_SECRET=live-sentinel\nAPI_GATEWAY_URL=https://demo.invalid\n');
  const config = JSON.parse(await readFile(join(root, 'qa', 'targets.example.json'), 'utf8'));
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  for (const [app, target] of Object.entries(config.databases)) {
    env[target.urlEnv] = `postgres://qa:qa@${target.identity}`;
    env[target.adminUrlEnv] = env[target.urlEnv];
    if (app === 'oversight-service') {
      env[target.urlEnv] = `postgres://ccms_logs_writer:qa@${target.identity}`;
      env[target.adminUrlEnv] = `postgres://ccms_oversight_qa:qa@${target.identity}`;
    }
  }
  return { dir, config, env };
}

describe('TT5 QA initializer in temporary filesystem sandboxes (no network)', () => {
  it('generates usable isolated environment files without copying local secrets', async () => {
    const { dir, config, env } = await sandbox();
    await writeFile(join(dir, 'qa', 'targets.local.json'), JSON.stringify(config));
    await exec(process.execPath, [join(dir, 'scripts', 'qa', 'manage.mjs'), 'init'], { cwd: dir, env, timeout: 60_000 });
    for (const app of apps) {
      const text = await readFile(join(dir, '.qa', 'env', `${app}.env`), 'utf8');
      const values = parseEnv(text);
      assert.equal(values.QA_SERVICE_KIND, app);
      assert.equal(values.DB_SYNCHRONIZE, 'false');
      assert.doesNotThrow(() => assertQaServiceTargets(values));
      if (config.databases[app]) assert.doesNotThrow(() => assertQaDatabaseTarget(values.DATABASE_URL, { env: values }));
      assert.doesNotMatch(text, /live-sentinel|https:\/\/demo\.invalid/);
      if (app === 'identity-service') assert.equal(createPrivateKey(values.JWT_PRIVATE_KEY.replace(/\\n/g, '\n')).asymmetricKeyType, 'rsa');
    }
    assert.match(await readFile(join(dir, 'apps', 'frontend', '.env.local'), 'utf8'), /live-sentinel/);
    const manifest = JSON.parse(await readFile(join(dir, '.qa', 'manifest.json'), 'utf8'));
    assert.equal(manifest.fixtures, 'NOT_CREATED');
    assert.equal(manifest.hostedSuite, 'NOT_RUN');
    await assert.rejects(exec(process.execPath, [join(dir, 'scripts', 'qa', 'manage.mjs'), 'init'], { cwd: dir, env, timeout: 60_000 }));
  });
  it('rejects protected destinations before writing a QA environment', async () => {
    const { dir, config, env } = await sandbox();
    config.services['core-service'] = config.protected.serviceOrigins[0];
    await writeFile(join(dir, 'qa', 'targets.local.json'), JSON.stringify(config));
    await assert.rejects(exec(process.execPath, [join(dir, 'scripts', 'qa', 'manage.mjs'), 'init'], { cwd: dir, env, timeout: 60_000 }));
    await assert.rejects(access(join(dir, '.qa')));
  });
});
