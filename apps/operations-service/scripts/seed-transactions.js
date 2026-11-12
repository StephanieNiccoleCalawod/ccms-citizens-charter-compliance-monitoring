// Sprint 6 TT1: seeded history v2 (demo only). See docs/seeded-history-v2.md for the runbook.
//
//   node --env-file=<env> scripts/seed-transactions.js --dry-run [options]       plan and print aggregates; no writes
//   node --env-file=<env> scripts/seed-transactions.js --operator=<id> --confirm=<db> [options]   import (replaces own rows)
//   node --env-file=<env> scripts/seed-transactions.js --remove --operator=<id> --confirm=<db>     remove every owned row
//   node --env-file=<env> scripts/seed-transactions.js --verify [options]        read back the stored rows' business digest
//
// Options: --seed=<text> (default "cccms-seed-plan-v2"), --from=YYYY-MM-DD (2026-07-01), --to=YYYY-MM-DD (2026-11-06),
//          --volume=<n> (700), --as-of=YYYY-MM-DD (Manila run date): the open rows sit in the 5 working days before it.
//
// Always required: SEED_TARGET=demo. Writes also require: the Operations database and the Oversight URL to be on the
// allowlists (SEED_DEMO_DATABASES, SEED_DEMO_OVERSIGHT_HOSTS), --confirm=<operations database name>, current
// operator-verified backups (SEED_BACKUP_OPERATIONS_REF, SEED_BACKUP_OVERSIGHT_REF, SEED_BACKUP_VERIFIED_AT within 24 h)
// and an operator account that Identity confirms is an active Super Admin. Nothing is scheduled; backfill and training
// are separate operator steps.
import { createDataSource, describeDatabaseUrl, isValidManilaDate, resolveDbTarget, toManilaDate } from 'ccms-shared';
import { entities } from '../src/lib/entities/index.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { ALGORITHM_VERSION, DEFAULTS } from '../src/modules/seed/config.js';
import { SeedInputError, datesBetween, inputsDigest, loadAccounts, loadBusyStaff, loadCalendar, loadCatalogue, loadRegistry, verifyOperator } from '../src/modules/seed/inputs.js';
import { PlanError, buildPlan } from '../src/modules/seed/planner.js';
import { SeedWriteError, purgeOversight, reservedRangeState, storedDigest, writeRun } from '../src/modules/seed/writer.js';

const FLAGS = new Set(['dry-run', 'remove', 'verify']);
const VALUES = new Set(['seed', 'from', 'to', 'volume', 'as-of', 'operator', 'confirm']);
const BACKUP_MAX_AGE_MS = 24 * 3_600_000;

export function parseArgs(argv, now = new Date()) {
  const flags = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    const [, name, value] = match;
    if (FLAGS.has(name)) {
      if (value !== undefined) throw new Error(`--${name} takes no value`);
    } else if (VALUES.has(name)) {
      if (value === undefined || value === '') throw new Error(`--${name} needs a value (--${name}=...)`);
    } else throw new Error(`Unknown option --${name}`);
    if (name in flags) throw new Error(`--${name} given twice`);
    flags[name] = value ?? true;
  }
  const modes = ['dry-run', 'remove', 'verify'].filter((m) => flags[m]);
  if (modes.length > 1) throw new Error('Choose one of --dry-run, --remove, --verify');
  const options = {
    mode: modes[0] ?? 'import',
    seed: flags.seed ?? DEFAULTS.seed,
    from: flags.from ?? DEFAULTS.from,
    to: flags.to ?? DEFAULTS.to,
    volume: flags.volume === undefined ? DEFAULTS.volume : Number(flags.volume),
    asOf: flags['as-of'] ?? toManilaDate(now),
    openTarget: DEFAULTS.openTarget,
    operator: flags.operator ?? null,
    confirm: flags.confirm ?? null,
  };
  if (options.seed.length > 100 || /[\u0000-\u001f]/.test(options.seed)) throw new Error('--seed must be 1-100 printable characters');
  for (const key of ['from', 'to', 'asOf']) if (!isValidManilaDate(options[key])) throw new Error(`--${key === 'asOf' ? 'as-of' : key} must be a date YYYY-MM-DD`);
  if (options.from > options.to) throw new Error('--from must not be after --to');
  if (options.to >= options.asOf) throw new Error('--as-of must be after --to');
  if (!Number.isInteger(options.volume) || options.volume < 100 || options.volume > 5000) throw new Error('--volume must be a whole number from 100 to 5000');
  return options;
}

function listOf(value) {
  return String(value ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/** SEED_TARGET=demo always; for writes the actual targets must be on the allowlists and backups must be current. */
export function checkTargets(options, env = process.env, now = new Date()) {
  if (env.SEED_TARGET !== 'demo') throw new Error('SEED_TARGET=demo is required (even for a dry run). This script never runs against production.');
  if (env.NODE_ENV === 'production' && env.SEED_ALLOW_NODE_ENV_PRODUCTION !== 'demo') throw new Error('Refusing to run with NODE_ENV=production');
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (Operations) is not configured');
  const where = describeDatabaseUrl(url);
  const database = `${where.host}/${where.database}`.toLowerCase();
  const target = resolveDbTarget(url);
  const result = { where, target };
  if (options.mode === 'dry-run' || options.mode === 'verify') return result;

  if (!listOf(env.SEED_DEMO_DATABASES).includes(database)) throw new Error(`The Operations database ${database} is not in SEED_DEMO_DATABASES`);
  if (options.confirm !== where.database) throw new Error(`Writes need --confirm=${where.database}`);
  const oversight = env.OVERSIGHT_SERVICE_URL ?? env.LOGS_SERVICE_URL;
  let oversightHost = null;
  try {
    oversightHost = new URL(oversight).host.toLowerCase();
  } catch {
    throw new Error('OVERSIGHT_SERVICE_URL (or LOGS_SERVICE_URL) must be the demo Oversight URL');
  }
  if (!listOf(env.SEED_DEMO_OVERSIGHT_HOSTS).includes(oversightHost)) throw new Error(`The Oversight host ${oversightHost} is not in SEED_DEMO_OVERSIGHT_HOSTS`);
  const verifiedAt = Date.parse(env.SEED_BACKUP_VERIFIED_AT ?? '');
  if (!env.SEED_BACKUP_OPERATIONS_REF || !env.SEED_BACKUP_OVERSIGHT_REF || !Number.isFinite(verifiedAt)) {
    throw new Error('Writes need SEED_BACKUP_OPERATIONS_REF, SEED_BACKUP_OVERSIGHT_REF and SEED_BACKUP_VERIFIED_AT (ISO time the operator verified both backups)');
  }
  if (verifiedAt > now.getTime() + 60_000 || now.getTime() - verifiedAt > BACKUP_MAX_AGE_MS) throw new Error('SEED_BACKUP_VERIFIED_AT must be within the last 24 hours');
  if (!options.operator) throw new Error('Writes need --operator=<account id of an active Super Admin>');
  return { ...result, oversight, backups: { operations: env.SEED_BACKUP_OPERATIONS_REF.slice(0, 200), oversight: env.SEED_BACKUP_OVERSIGHT_REF.slice(0, 200) } };
}

function print(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checked = checkTargets(options);
  print('mode', options.mode);
  print('target', `${checked.where.host}/${checked.where.database} (${checked.target.target})`);
  print('algorithm', ALGORITHM_VERSION);
  print('random seed', options.seed);
  print('period', `${options.from} to ${options.to}, volume ${options.volume}`);
  print('as-of (Manila)', options.asOf);

  const dataSource = createDataSource({ url: process.env.DATABASE_URL, entities, synchronize: false });
  await dataSource.initialize();
  // A dry run or verify reads through ONE connection inside a READ ONLY, REPEATABLE READ transaction (a consistent
  // snapshot that PostgreSQL itself refuses to write with), rolled back at the end.
  const readOnly = options.mode === 'dry-run' || options.mode === 'verify';
  const runner = readOnly ? dataSource.createQueryRunner() : null;
  if (runner) {
    await runner.connect();
    await runner.query('START TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  }
  const reader = runner ?? dataSource;
  try {
    const [{ db }] = await reader.query('SELECT current_database() AS db');
    if (db !== checked.where.database) throw new Error('The connected database is not the configured one');
    const serviceKey = process.env.SERVICE_KEY;
    const state = await reservedRangeState(reader);
    print('reserved range now', state);

    if (options.mode === 'verify') {
      print('stored rows', await storedDigest(reader));
      return 0;
    }
    if (state.unowned) throw new SeedWriteError(`${state.unowned} unowned row(s) in the reserved range: review them first`);
    const operator = options.operator ? await verifyOperator(options.operator, { serviceKey }) : null;

    let plan = null;
    let digest = null;
    if (options.mode !== 'remove') {
      const core = createCoreClient();
      const catalogue = await loadCatalogue({ serviceKey });
      const officeIds = catalogue.offices.map((o) => o.office_id);
      const accounts = await loadAccounts(officeIds.filter((id) => catalogue.offices.find((o) => o.office_id === id)?.office_code?.startsWith('PUP-')), { serviceKey });
      const registry = await loadRegistry(reader);
      const busyStaff = await loadBusyStaff(reader);
      const lastDay = toManilaDate(new Date(Date.parse(`${options.asOf}T00:00:00+08:00`) - 1));
      const calendar = await loadCalendar(core, [...accounts.keys()], datesBetween(options.from, lastDay));
      digest = inputsDigest({ catalogue, accounts, registry, calendar, busyStaff });
      print('inputs digest', digest);
      plan = await buildPlan({ inputs: { catalogue, accounts, registry, calendar, busyStaff }, options, core });
      print('plan digest', plan.digest);
      for (const [key, value] of Object.entries(plan.diagnostics)) print(key, value);
    }
    print('planned removal', { owned_rows: state.owned, pending_oversight_purge: state.pendingOversightPurge });
    if (options.mode === 'dry-run') {
      console.log('Dry run: nothing was written.');
      return 0;
    }

    const { runId, counts } = await writeRun(dataSource, {
      mode: options.mode === 'remove' ? 'REMOVE' : 'IMPORT', plan, options, operator, inputsDigest: digest, backups: checked.backups,
    });
    print('run id', runId);
    print('committed', counts);
    try {
      print('oversight purge', await purgeOversight(dataSource, { oversightUrl: checked.oversight, serviceKey }));
    } catch (err) {
      console.error(`PARTIAL: Operations committed run ${runId}, but the Oversight purge did not finish (${err.message}).`);
      console.error('Recovery: fix Oversight (ANALYTICS_SEED_PURGE=enabled on the demo), then run --remove again; it retries the pending purge safely.');
      return 2;
    }
    console.log('Next (explicit operator steps, not automatic): TT2 analytics backfill, then the CC052 initial training.');
    return 0;
  } finally {
    if (runner) {
      await runner.query('ROLLBACK').catch(() => {});
      await runner.release();
    }
    await dataSource.destroy();
  }
}

// Runs only as a command (tests import parseArgs and checkTargets without running anything).
if (String(process.argv[1] ?? '').replaceAll('\\', '/').endsWith('scripts/seed-transactions.js')) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    const details = err instanceof PlanError ? err.diagnostics : err instanceof SeedInputError || err instanceof SeedWriteError ? err.details : null;
    console.error(`FAILED: ${err.message}`);
    if (details) console.error(JSON.stringify(details, null, 2));
    process.exitCode = 1;
  });
}
