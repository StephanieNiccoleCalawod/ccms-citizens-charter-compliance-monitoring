import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { assertQaDatabaseTarget, assertQaServiceTargets } from 'ccms-shared/qa';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const qaDir = join(root, '.qa');
export const services = ['identity-service', 'core-service', 'operations-service', 'oversight-service'];
export const apps = [...services, 'api-gateway', 'frontend'];
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export const saveJson = async (path, value) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

// Inherit OS tooling paths, never an operator's database, mail or integration configuration.
export function cleanProcessEnv(values) {
  const safe = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'LANG']) {
    if (process.env[key] !== undefined) safe[key] = process.env[key];
  }
  return { ...safe, ...values, TZ: 'UTC' };
}

export async function appEnv(app) {
  if (!apps.includes(app)) throw new Error('Unknown QA service');
  const values = parseEnv(await readFile(join(qaDir, 'env', `${app}.env`), 'utf8'));
  if (values.CCMS_ENVIRONMENT !== 'qa' || values.QA_SERVICE_KIND !== app) throw new Error('The generated QA environment does not belong to this service');
  assertQaServiceTargets(values);
  if (services.includes(app)) assertQaDatabaseTarget(values.DATABASE_URL, { env: values });
  return cleanProcessEnv(values);
}

export function execute(file, args, { cwd = root, env, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd, env, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) {
      const consume = (chunk) => { output = (output + chunk.toString()).slice(-2_000_000); };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
    }
    child.once('error', () => reject(new Error('The QA command could not be started')));
    child.once('exit', (code, signal) => resolvePromise({ code: code ?? 1, signal, output }));
  });
}

export async function approvedFixtures() {
  const pack = await readJson(join(root, 'qa', 'fixtures.local.json'));
  if (pack.approved !== true || !pack.sourceReference || pack.sourceReference.includes('REQUIRED') || pack.fixtureW?.approved !== true || !pack.fixtureW.sourceReference || pack.fixtureW.sourceReference.includes('REQUIRED') || !Array.isArray(pack.fixtureW.workingHours) || pack.fixtureW.workingHours.length !== 7 || !Array.isArray(pack.fixtureW.entries) || !pack.fixtureW.entries.length) {
    throw new Error('Supply the reviewed authoritative EB14 list and complete fixture W before fixture creation');
  }
  if (!Array.isArray(pack.offices) || !Array.isArray(pack.accounts) || !Array.isArray(pack.checklist) || !pack.checklist.length) throw new Error('The approved fixture pack is incomplete');
  const officeKeys = new Set(pack.offices.map((office) => office.key));
  if (officeKeys.size !== pack.offices.length || pack.offices.some((office) => !office.key || !office.office_code || !office.office_name)) throw new Error('Fixture offices need unique keys, codes and names');
  for (const account of [pack.superAdmin, ...pack.accounts]) {
    if (!account || typeof account.email !== 'string' || !/^[^\s@]+@[^\s@]+\.test$/i.test(account.email)) throw new Error('QA fixture accounts require .test email addresses');
  }
  const emails = [pack.superAdmin, ...pack.accounts].map((account) => account.email.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) throw new Error('QA fixture account email addresses must be unique');
  const entryKeys = pack.fixtureW.entries.map((entry) => entry.key);
  if (entryKeys.some((key) => !key) || new Set(entryKeys).size !== entryKeys.length) throw new Error('Fixture W entries need unique stable keys');
  const checklistIds = pack.checklist.map((item) => item.id);
  if (new Set(checklistIds).size !== checklistIds.length || ['calendar-w', 'accounts', 'mailbox', 'mock-fms', 'mock-scms'].some((id) => !checklistIds.includes(id))) throw new Error('The EB14 checklist must include the calendar, accounts, mailbox and both mock systems');
  for (const account of pack.accounts) {
    if (['office_head', 'office_staff'].includes(account.role) && !officeKeys.has(account.office_key)) throw new Error('Office-bound QA accounts need a declared fixture office');
  }
  const roles = new Set(['super_admin', ...pack.accounts.map((account) => account.role)]);
  if (['office_head', 'office_staff', 'executive'].some((role) => !roles.has(role))) throw new Error('The approved QA pack must cover the required application roles');
  return pack;
}

export function redact(text, env) {
  let clean = text;
  for (const [key, value] of Object.entries(env)) {
    if (value && /PASSWORD|SECRET|TOKEN|PRIVATE_KEY|SERVICE_KEY|DATABASE.*URL/.test(key)) clean = clean.split(value).join('[redacted]');
  }
  return clean.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]');
}
