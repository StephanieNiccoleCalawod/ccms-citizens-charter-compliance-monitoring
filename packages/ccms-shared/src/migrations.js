import { MigrationExecutor } from 'typeorm';

// TT1: hosted database changes go through numbered TypeORM migrations only.
//
//   DB_TARGET=local    a disposable or developer database. db:sync (schema synchronization) is allowed.
//   DB_TARGET=hosted   the shared hosted database (Neon). Schema synchronization is refused, always.
//
// When DB_TARGET is not set the target is worked out from the connection string, and anything that is not
// clearly a loopback address is treated as hosted (fail closed). A known hosted provider (Neon and similar)
// is hosted whatever DB_TARGET says.

export const MIGRATIONS_TABLE = 'typeorm_migrations';
// Session advisory lock held by migrate:run, migrate:revert and migrate:baseline, so two runs cannot interleave.
const MIGRATION_LOCK = [43436, 900];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const HOSTED_PROVIDER = /(^|\.)(neon\.tech|supabase\.co|supabase\.com|rds\.amazonaws\.com|render\.com|aivencloud\.com|elephantsql\.com)$/i;

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Connection details safe to print: never the password or query string. */
export function describeDatabaseUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) return { host: '(unparseable)', port: '', database: '', user: '' };
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: decodeURIComponent(parsed.username),
  };
}

/**
 * Works out whether a connection string points at a local or a hosted database.
 * Returns { target: 'local' | 'hosted', declared, reason }. Throws when DB_TARGET has an unknown value or
 * says local for a known hosted provider (a contradiction is never resolved in favour of "local").
 */
export function resolveDbTarget(url, declared = process.env.DB_TARGET) {
  const value = declared?.trim().toLowerCase() || undefined;
  if (value && value !== 'local' && value !== 'hosted') {
    throw new Error(`DB_TARGET must be "local" or "hosted" (got "${declared}")`);
  }
  const host = parseUrl(url)?.hostname?.toLowerCase() ?? '';
  if (HOSTED_PROVIDER.test(host)) {
    if (value === 'local') throw new Error(`DB_TARGET=local contradicts the hosted database host ${host}`);
    return { target: 'hosted', declared: value, reason: `host ${host} is a hosted provider` };
  }
  if (value === 'hosted') return { target: 'hosted', declared: value, reason: 'DB_TARGET=hosted' };
  if (value === 'local') return { target: 'local', declared: value, reason: 'DB_TARGET=local' };
  if (LOOPBACK_HOSTS.has(host) || /^127\./.test(host)) return { target: 'local', declared: value, reason: `loopback host ${host}` };
  return { target: 'hosted', declared: value, reason: `host ${host || '(none)'} is not loopback and DB_TARGET is not set` };
}

/**
 * Refuses schema synchronization (db:sync, the development bootstrap, synchronize: true) on a hosted target.
 * Call it before connecting, so nothing at all is sent to the database.
 */
export function assertSchemaSyncAllowed(url, command = 'Schema synchronization') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${command} is refused: NODE_ENV=production. Use the numbered migrations, even for a local database.`);
  }
  const { target, reason } = resolveDbTarget(url);
  if (target === 'hosted') {
    throw new Error(
      `${command} is refused: the database target is hosted (${reason}). Schema synchronization is for disposable ` +
        'local databases only. Change a hosted database with the numbered migrations (npm run migrate:run).',
    );
  }
}

/** The connection the migration commands use: the schema owner when one is configured. */
export function migrationUrl(env = process.env) {
  return env.DATABASE_ADMIN_URL || env.DATABASE_URL;
}

function timestampOf(name) {
  const timestamp = Number.parseInt(String(name).slice(-13), 10);
  if (!Number.isFinite(timestamp)) throw new Error(`Migration name ${name} must end with a 13-digit timestamp`);
  return timestamp;
}

// ---------------------------------------------------------------------------------------------------------------
// Schema fingerprint: a normalised, order-independent description of the public schema, used to verify a baseline
// before it is adopted and to prove that a step changed no business schema. It reads catalogs only.
// ---------------------------------------------------------------------------------------------------------------

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export async function schemaFingerprint(queryable, { exclude = [MIGRATIONS_TABLE] } = {}) {
  const skip = new Set(exclude);
  const out = {};
  const put = (key, value) => {
    out[key] = squash(value);
  };
  const relkinds = "c.relkind IN ('r', 'p')";
  const publicRel = "JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'";

  for (const row of await queryable.query(`SELECT c.relname FROM pg_class c ${publicRel} WHERE ${relkinds}`)) {
    if (!skip.has(row.relname)) put(`table:${row.relname}`, '');
  }
  for (const row of await queryable.query(
    `SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid ${publicRel}
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE ${relkinds} AND a.attnum > 0 AND NOT a.attisdropped`,
  )) {
    if (!skip.has(row.relname)) {
      put(`column:${row.relname}.${row.attname}`, `${row.type}${row.attnotnull ? ' NOT NULL' : ''}${row.def ? ` DEFAULT ${row.def}` : ''}`);
    }
  }
  for (const row of await queryable.query(
    `SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS def, con.convalidated, con.contype,
            (SELECT bool_and(a.attnotnull) FROM pg_attribute a
              WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS columns_not_null
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid ${publicRel}`,
  )) {
    // PostgreSQL 18 also stores table NOT NULL constraints in pg_constraint. Validated ones are already
    // represented by each column's attnotnull above. Keep unvalidated/inconsistent ones as blocking differences.
    if (row.contype === 'n' && row.convalidated && row.columns_not_null === true) continue;
    if (!skip.has(row.relname)) put(`constraint:${row.relname}.${row.conname}`, `${row.def}${row.convalidated ? '' : ' NOT VALID'}`);
  }
  for (const row of await queryable.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'")) {
    if (!skip.has(row.tablename)) put(`index:${row.tablename}.${row.indexname}`, row.indexdef);
  }
  for (const row of await queryable.query(
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid ${publicRel} WHERE NOT t.tgisinternal`,
  )) {
    if (!skip.has(row.relname)) put(`trigger:${row.relname}.${row.tgname}`, row.def);
  }
  for (const row of await queryable.query(
    `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, md5(btrim(p.prosrc)) AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
  )) {
    put(`function:${row.proname}(${row.args})`, `md5 ${row.body}`);
  }
  for (const row of await queryable.query("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'")) {
    put(`extension:${row.extname}`, '');
  }
  // Grants to anyone other than the table owner (Oversight's runtime roles and PUBLIC).
  for (const row of await queryable.query(
    `SELECT c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, a.privilege_type
       FROM pg_class c ${publicRel}, aclexplode(c.relacl) a
      WHERE ${relkinds} AND a.grantee <> c.relowner`,
  )) {
    if (!skip.has(row.relname)) put(`grant:${row.relname}.${row.grantee}.${row.privilege_type}`, '');
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Differences between an expected and an actual fingerprint. */
export function compareFingerprints(expected, actual) {
  const missing = [];
  const changed = [];
  const unexpected = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) missing.push(key);
    else if (actual[key] !== value) changed.push({ key, expected: value, actual: actual[key] });
  }
  for (const key of Object.keys(actual)) if (!(key in expected)) unexpected.push(key);
  return { missing, changed, unexpected, identical: !missing.length && !changed.length && !unexpected.length };
}

/** Reject incompatible pre-existing migration objects before any DDL. Missing objects are added by up(). */
export async function assertMigrationObjects(queryable, expected) {
  const actual = await schemaFingerprint(queryable);
  const incompatible = Object.keys(expected).filter((key) => key in actual && !matchesDefinition(expected[key], actual[key]));
  if (incompatible.length) {
    throw new Error(`Incompatible existing migration objects: ${incompatible.join(', ')}. Nothing repaired automatically; review the definitions and write a fix-up migration.`);
  }
  return actual;
}

const matchesDefinition = (expected, actual) => (Array.isArray(expected) ? expected : [expected]).includes(actual);

/** Existing numbered-table additions must be complete and exact; partial/unknown schemas are never repaired silently. */
export async function assertNewTablesCompatible(queryable, expected) {
  const actual = await schemaFingerprint(queryable);
  const tables = Object.keys(expected).filter((key) => key.startsWith('table:')).map((key) => key.slice(6));
  if (!tables.length) throw new Error('A frozen schema contract is required for table migrations');
  const belongs = (key, table) => key === `table:${table}` || ['column', 'constraint', 'index', 'trigger', 'grant'].some((kind) => key.startsWith(`${kind}:${table}.`));
  const present = tables.filter((table) => `table:${table}` in actual);
  if (present.length && present.length !== tables.length) throw new Error('Partial existing migration tables; review a fix-up migration before proceeding');
  for (const table of present) {
    for (const key of Object.keys(expected).filter((key) => belongs(key, table))) {
      if (!(key in actual) || !matchesDefinition(expected[key], actual[key])) throw new Error(`Incompatible existing migration object: ${key}`);
    }
    for (const key of Object.keys(actual).filter((key) => belongs(key, table))) {
      if (!(key in expected)) throw new Error(`Unreviewed existing migration object: ${key}`);
    }
  }
  return present.length === tables.length;
}

export async function assertTablesEmptyBeforeDrop(queryable, migrationName, tables) {
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid frozen migration table name');
    const [{ exists }] = await queryable.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
    if (!exists) continue;
    const [{ count }] = await queryable.query(`SELECT count(*)::int AS count FROM "${table}"`);
    if (count && !(process.env.CCMS_ALLOW_DATA_LOSS ?? '').split(',').map((v) => v.trim()).includes(migrationName)) {
      throw new Error(`Reverting ${migrationName} would delete ${count} row(s) from ${table}. Back up first; explicit CCMS_ALLOW_DATA_LOSS=${migrationName} is required.`);
    }
  }
}

/** Extras must be known Sprint 5 objects AND match their reviewed PostgreSQL definitions. */
export function compareBaseline(baseline, actual) {
  const diff = compareFingerprints(baseline.schema, actual);
  const allowed = baseline.allowedExtras ?? {};
  for (const key of diff.unexpected) {
    if (!(key in allowed) || !matchesDefinition(allowed[key], actual[key])) {
      diff.changed.push({ key, expected: allowed[key] ?? '(not an approved Sprint 5 object)', actual: actual[key] });
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers for migration classes.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A baseline creates the whole schema of an EMPTY database. On a database that already has any of the baseline's
 * tables it refuses, because an existing database adopts the baseline (migrate:baseline) instead of re-creating it.
 */
export async function assertEmptyForBaseline(queryRunner, tables, migrationName) {
  const present = [];
  for (const table of tables) {
    const [{ name }] = await queryRunner.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
    if (name) present.push(table);
  }
  if (present.length) {
    throw new Error(
      `${migrationName} creates the schema of an empty database, but this database already has ${present.join(', ')}. ` +
        'For an existing database run `npm run migrate:baseline` (records the baseline without changing any object), ' +
        'then `npm run migrate:run`.',
    );
  }
}

export function refuseBaselineRevert(migrationName) {
  throw new Error(
    `${migrationName} cannot be reverted: it is the starting schema, and reverting it would drop every table and ` +
      'all records. Restore the pre-migration backup instead (see docs/database-migrations.md).',
  );
}

/**
 * Down migrations that drop columns delete whatever was stored in them. Refuse while any row holds a value, unless
 * the operator names this exact migration in CCMS_ALLOW_DATA_LOSS (comma-separated) after taking a backup.
 */
export async function assertColumnsEmptyBeforeDrop(queryRunner, migrationName, table, columns) {
  const [{ exists }] = await queryRunner.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
  if (!exists) return;
  const present = [];
  for (const column of columns) {
    const rows = await queryRunner.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
      [table, column],
    );
    if (rows.length) present.push(column);
  }
  if (!present.length) return;
  const where = present.map((column) => `"${column}" IS NOT NULL`).join(' OR ');
  const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM "${table}" WHERE ${where}`);
  const allowed = (process.env.CCMS_ALLOW_DATA_LOSS ?? '').split(',').map((v) => v.trim());
  if (count > 0 && !allowed.includes(migrationName)) {
    throw new Error(
      `Reverting ${migrationName} would delete values in ${count} row(s) of ${table} (${present.join(', ')}). ` +
        `Take a backup first, then re-run with CCMS_ALLOW_DATA_LOSS=${migrationName} if the loss is intended.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The migrate:* command line, shared by the four services. Usage (from a service directory):
//   node scripts/migrate.js show | run | revert | check-baseline | baseline  [--confirm=<database>] [--accept-extra]
// ---------------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? true;
    else positional.push(arg);
  }
  return { command: positional[0], flags };
}

function printFingerprintDiff(log, diff) {
  for (const key of diff.missing) log(`  missing     ${key}`);
  for (const item of diff.changed) log(`  changed     ${item.key}\n      expected: ${item.expected}\n      actual:   ${item.actual}`);
  for (const key of diff.unexpected) log(`  unexpected  ${key}`);
}

/**
 * Runs one migration command. `createSource(url)` returns an uninitialised DataSource with the service's
 * migrations; `baseline` is { name, schema } where schema is the committed fingerprint of the baseline.
 * Returns the process exit code.
 */
export async function runMigrationCli({ service, argv = process.argv.slice(2), env = process.env, createSource, baseline, log = console.log }) {
  const { command, flags } = parseArgs(argv);
  const commands = ['show', 'run', 'revert', 'check-baseline', 'baseline'];
  if (!commands.includes(command)) {
    log(`Usage: migrate <${commands.join('|')}> [--confirm=<database>] [--accept-extra]`);
    return 2;
  }
  const url = migrationUrl(env);
  if (!url) throw new Error('DATABASE_URL (or DATABASE_ADMIN_URL) is not configured');
  const where = describeDatabaseUrl(url);
  const { target, declared, reason } = resolveDbTarget(url, env.DB_TARGET);
  log(`${service}: ${command} on database "${where.database}" at ${where.host}:${where.port} as ${where.user} (target ${target}: ${reason})`);

  const writes = ['run', 'revert', 'baseline'].includes(command);
  if (target === 'hosted' && writes) {
    if (/-pooler\..*neon\.tech$/i.test(where.host)) {
      throw new Error('Migration writes require a direct Neon connection, not a pooled host. Set DATABASE_ADMIN_URL to the direct endpoint so the session advisory lock remains effective.');
    }
    // The hosted deployment configuration must be explicit, and the operator must name the database.
    if (declared !== 'hosted') throw new Error('Set DB_TARGET=hosted explicitly to change a hosted database.');
    if (flags.confirm !== where.database) {
      throw new Error(`Refusing to ${command} a hosted database without --confirm=${where.database}.`);
    }
  }

  const dataSource = createSource(url);
  if (dataSource.options.synchronize) throw new Error('Migration data sources must not synchronize the schema');
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  let locked = false;
  try {
    const [{ database }] = await runner.query('SELECT current_database() AS database');
    if (flags.confirm && flags.confirm !== true && flags.confirm !== database) {
      throw new Error(`--confirm=${flags.confirm} does not match the connected database "${database}"`);
    }
    const executor = new MigrationExecutor(dataSource, runner);
    const known = dataSource.migrations.map((m) => m.name ?? m.constructor.name);
    const executed = async () => (await executor.getExecutedMigrations()).map((m) => m.name);

    if (command === 'show') {
      const done = new Set(await executed());
      const tracked = await runner.hasTable(dataSource.options.migrationsTableName);
      if (!tracked) log(`Migration tracking is not set up (no ${dataSource.options.migrationsTableName} table).`);
      for (const name of known) log(`  [${done.has(name) ? 'X' : ' '}] ${name}`);
      for (const name of done) if (!known.includes(name)) log(`  [?] ${name}  (recorded in the database, not in this code)`);
      const pending = known.filter((name) => !done.has(name));
      log(pending.length ? `${pending.length} pending.` : 'Up to date.');
      return 0;
    }

    if (command === 'check-baseline') {
      // Read-only: compares the live schema with the committed baseline fingerprint.
      const diff = compareBaseline(baseline, await schemaFingerprint(runner));
      if (diff.identical) log(`The schema matches ${baseline.name} exactly.`);
      else printFingerprintDiff(log, diff);
      const blocking = diff.missing.length + diff.changed.length;
      if (blocking) log(`${blocking} difference(s) block baseline adoption. Do not adopt; report them for a reviewed fix-up migration.`);
      else if (diff.unexpected.length) log(`${diff.unexpected.length} verified Sprint 5 object(s) beyond the baseline. Adoption needs --accept-extra.`);
      return blocking ? 1 : 0;
    }

    await runner.query('SELECT pg_advisory_lock($1, $2)', MIGRATION_LOCK);
    locked = true;

    if (command === 'baseline') {
      const done = await executed();
      if (done.includes(baseline.name)) {
        log(`${baseline.name} is already recorded. Nothing changed.`);
        return 0;
      }
      if (done.length) throw new Error(`Migrations are already recorded (${done.join(', ')}) but not the baseline; investigate before adopting.`);
      const diff = compareBaseline(baseline, await schemaFingerprint(runner));
      printFingerprintDiff(log, diff);
      if (diff.missing.length || diff.changed.length) {
        throw new Error('The schema does not match the baseline (see above). Baseline not adopted; nothing changed.');
      }
      if (!Object.keys(await schemaFingerprint(runner)).some((key) => key.startsWith('table:'))) {
        throw new Error('This database is empty. Initialise it with `npm run migrate:run` instead of adopting the baseline.');
      }
      if (diff.unexpected.length && !flags['accept-extra']) {
        throw new Error(`${diff.unexpected.length} object(s) beyond the baseline (see above). Review them, then re-run with --accept-extra.`);
      }
      // Bookkeeping only: the migrations table and one row. No business object or record is touched.
      await runner.startTransaction();
      try {
        await executor.createMigrationsTableIfNotExist(runner);
        await executor.insertExecutedMigration(runner, { name: baseline.name, timestamp: timestampOf(baseline.name) });
        await runner.commitTransaction();
      } catch (err) {
        await runner.rollbackTransaction();
        throw err;
      }
      log(`Recorded ${baseline.name} as applied (no schema or data change). Next: npm run migrate:show, then migrate:run.`);
      return 0;
    }

    if (command === 'run') {
      const done = await executed();
      const unknown = done.filter((name) => !known.includes(name));
      if (unknown.length) throw new Error(`Unknown recorded migrations: ${unknown.join(', ')}. Use the matching reviewed code before running migrations.`);
      if (!done.length) {
        // Untracked database: only an empty one may be initialised by running the baseline.
        const tables = Object.keys(await schemaFingerprint(runner)).filter((key) => key.startsWith('table:'));
        if (tables.length) {
          throw new Error(
            `This database already has tables (${tables.length}) but no recorded migrations. Adopt the baseline first: ` +
              'npm run migrate:check-baseline, then npm run migrate:baseline.',
          );
        }
        log('Empty database: initialising it from the baseline.');
      }
      const applied = await dataSource.runMigrations({ transaction: 'each' });
      log(applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'No pending migrations.');
      return 0;
    }

    if (command === 'revert') {
      const done = await executed();
      if (!done.length) {
        log('No recorded migrations. Nothing to revert.');
        return 0;
      }
      await dataSource.undoLastMigration({ transaction: 'each' });
      log(`Reverted: ${done[0]}`);
      return 0;
    }
    return 2;
  } finally {
    if (locked) await runner.query('SELECT pg_advisory_unlock($1, $2)', MIGRATION_LOCK).catch(() => {});
    await runner.release();
    await dataSource.destroy();
  }
}
