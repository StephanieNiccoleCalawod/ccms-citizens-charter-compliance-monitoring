import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, exportPKCS8 } from 'jose';

const apps = ['frontend', 'api-gateway', 'identity-service', 'core-service', 'operations-service', 'oversight-service'];
// Refuse partial regeneration, which could give new services a different shared key.
const existing = [];
for (const app of apps) {
  try {
    await readFile(new URL(`../apps/${app}/.env.local`, import.meta.url), 'utf8');
    existing.push(app);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
if (existing.length === apps.length) {
  console.log('All local environment files already exist; kept them unchanged.');
  process.exit(0);
}
if (existing.length) {
  throw new Error(`Local files already exist for ${existing.join(', ')}. Copy missing .env.example files manually and reuse the existing SERVICE_KEY; no files changed.`);
}
const serviceKey = randomBytes(32).toString('hex');
const cronSecret = randomBytes(32).toString('hex');
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const pem = (await exportPKCS8(privateKey)).trim().replaceAll('\n', '\\n');
for (const app of apps) {
  const dir = new URL(`../apps/${app}/`, import.meta.url);
  let example = await readFile(new URL('.env.example', dir), 'utf8');
  example = example.replace('SERVICE_KEY=change-me-dev-service-key', `SERVICE_KEY=${serviceKey}`)
    .replace('CRON_SECRET=change-me-dev-cron-secret', `CRON_SECRET=${cronSecret}`);
  if (app === 'identity-service') example += `\nJWT_PRIVATE_KEY="${pem}"\n`;
  try {
    await writeFile(new URL('.env.local', dir), example, { flag: 'wx', mode: 0o600 });
    console.log(`Created apps/${app}/.env.local`);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    console.log(`Kept apps/${app}/.env.local; ensure SERVICE_KEY matches across existing files`);
  }
}
