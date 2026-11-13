// TT1 acceptance checks for the numbered TypeORM migrations, on disposable databases only (TEST_PG_URL, the same
// server the service tests use). Nothing here can reach a hosted database: every URL is built from TEST_PG_URL and
// the hosted-target cases use either a loopback database marked DB_TARGET=hosted or a host that is never contacted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  assertSchemaSyncAllowed,
  compareBaseline,
  compareFingerprints,
  createDataSource,
  MIGRATIONS_TABLE,
  resolveDbTarget,
  schemaFingerprint,
} from 'ccms-shared';
import { DEFAULT_TEST_PG_URL } from 'ccms-shared/testing';

const ADMIN_URL = process.env.TEST_PG_URL ?? DEFAULT_TEST_PG_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ADMIN_URL).hostname)) {
  throw new Error('Migration acceptance tests require a loopback disposable PostgreSQL server; hosted URLs are refused.');
}
const SERVICES = ['identity', 'core', 'operations', 'oversight'];
const created = [];

function appDir(service) {
  return fileURLToPath(new URL(`../apps/${service}-service/`, import.meta.url));
}

async function admin(sql) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

async function emptyDatabase(prefix) {
  const name = `ccms_tt1_${prefix}_${randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  created.push(name);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn({ query: async (sql, params) => (await client.query(sql, params)).rows });
  } finally {
    await client.end();
  }
}

const fingerprint = (url) => withClient(url, (q) => schemaFingerprint(q));

/**
 * md5 of every row of every business table: proves that a step changed no record. With `columnsFrom` (a fingerprint
 * taken earlier) only the columns that existed then are hashed, so a newly added empty column does not count as a
 * change to existing records.
 */
async function dataChecksum(url, columnsFrom) {
  return withClient(url, async (q) => {
    const tables = await q.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r' AND c.relname <> $1 ORDER BY 1`,
      [MIGRATIONS_TABLE],
    );
    const out = {};
    for (const { relname } of tables) {
      if (columnsFrom && !(`table:${relname}` in columnsFrom)) continue;
      let row = 't';
      if (columnsFrom) {
        const cols = Object.keys(columnsFrom)
          .filter((key) => key.startsWith(`column:${relname}.`))
          .map((key) => `"${key.slice(`column:${relname}.`.length)}"`)
          .sort();
        row = `row(${cols.join(', ')})`;
      }
      const [result] = await q.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(${row}::text, '|' ORDER BY ${row}::text), '')) AS h FROM "${relname}" t`,
      );
      out[relname] = `${result.n}:${result.h}`;
    }
    return out;
  });
}

function cli(service, url, args, extraEnv = {}) {
  const env = { ...process.env, DATABASE_URL: url, DATABASE_ADMIN_URL: '', DB_TARGET: '', CCMS_ALLOW_DATA_LOSS: '', ...extraEnv };
  const result = spawnSync(process.execPath, ['scripts/migrate.js', ...args], { cwd: appDir(service), env, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function revertAfterIdentityCc046(url) {
  for (const migration of ['Cc056PermissionSwitches1794650000000']) {
    const reverted = cli('identity', url, ['revert']);
    assert.equal(reverted.code, 0, reverted.out);
    assert.ok(reverted.out.includes(`Reverted: ${migration}`), reverted.out);
  }
}

function syncDb(service, url, extraEnv = {}) {
  const env = { ...process.env, DATABASE_URL: url, DATABASE_ADMIN_URL: '', DB_TARGET: '', ...extraEnv };
  const result = spawnSync(process.execPath, ['scripts/sync-db.js'], { cwd: appDir(service), env, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

async function load(service) {
  const { migrations, baseline } = await import(`../apps/${service}-service/migrations/index.js`);
  return { migrations, baseline };
}

/** A database in exactly the baseline state with no migration bookkeeping: stands in for an isolated hosted copy. */
async function untrackedBaselineCopy(service) {
  const { migrations } = await load(service);
  const db = await emptyDatabase(`${service}_copy`);
  const source = createDataSource({ url: db.url, entities: [], migrations: [migrations[0]], synchronize: false });
  await source.initialize();
  try {
    await source.runMigrations({ transaction: 'each' });
    await source.query(`DROP TABLE ${MIGRATIONS_TABLE}`);
  } finally {
    await source.destroy();
  }
  return db;
}

const SAMPLE_ROWS = {
  identity: `INSERT INTO accounts (account_id, employee_no, full_name, email, password_hash, role_key)
             VALUES ('00000000-0000-4000-8000-000000000001', 'E-1', 'Sample Admin', 'admin@example.test', 'x', 'super_admin')`,
  core: `INSERT INTO offices (office_id, office_code, office_name) VALUES ('00000000-0000-4000-8000-000000000002', 'REG', 'Registrar')`,
  operations: `INSERT INTO counters (counter_id, office_id, label) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Window 1')`,
  oversight: `INSERT INTO audit_log (audit_id, actor_role, action, entity_type, occurred_at)
              VALUES ('00000000-0000-4000-8000-000000000004', 'system', 'TEST', 'test', now())`,
};

before(async () => {
  await admin('SELECT 1'); // fail fast when no disposable PostgreSQL is available
});

after(async () => {
  for (const name of created) await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
});

describe('hosted target detection', () => {
  test('production synchronization is refused even with an explicitly local target', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(() => assertSchemaSyncAllowed('postgres://unused@127.0.0.1:1/unused'), /NODE_ENV=production/);
      assert.throws(() => createDataSource({ url: 'postgres://unused@127.0.0.1:1/unused', entities: [], synchronize: true }), /NODE_ENV=production/);
      for (const service of SERVICES) {
        const result = syncDb(service, 'postgres://unused@127.0.0.1:1/unused', { DB_TARGET: 'local', NODE_ENV: 'production' });
        assert.equal(result.code, 1, result.out);
        assert.match(result.out, /NODE_ENV=production/);
        assert.doesNotMatch(result.out, /ECONNREFUSED|EACCES/);
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('baseline extras are restricted by name and exact definition', () => {
    const baseline = { schema: { 'table:accounts': '' }, allowedExtras: { 'column:accounts.position': 'character varying(100)' } };
    assert.equal(compareBaseline(baseline, { ...baseline.schema, ...baseline.allowedExtras }).changed.length, 0);
    assert.equal(compareBaseline(baseline, { ...baseline.schema, 'column:accounts.position': 'text' }).changed.length, 1);
    assert.equal(compareBaseline(baseline, { ...baseline.schema, 'table:unreviewed': '' }).changed.length, 1);
  });
  test('DB_TARGET and the connection host decide the target, failing closed', () => {
    assert.equal(resolveDbTarget('postgres://u:p@127.0.0.1:5432/db', undefined).target, 'local');
    assert.equal(resolveDbTarget('postgres://u:p@localhost/db', undefined).target, 'local');
    assert.equal(resolveDbTarget('postgres://u:p@127.0.0.1/db', 'hosted').target, 'hosted');
    assert.equal(resolveDbTarget('postgres://u:p@db.internal/db', undefined).target, 'hosted');
    assert.equal(resolveDbTarget('postgres://u:p@core-db:5432/db', 'local').target, 'local');
    assert.equal(resolveDbTarget('postgres://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/db', undefined).target, 'hosted');
    assert.throws(() => resolveDbTarget('postgres://u:p@ep-x.neon.tech/db', 'local'), /contradicts/);
    assert.throws(() => resolveDbTarget('postgres://u:p@127.0.0.1/db', 'production'), /must be "local" or "hosted"/);
  });

  test('schema synchronization is refused for a hosted target before any connection', () => {
    const neon = 'postgres://u:p@ep-x.neon.tech/db?sslmode=require';
    assert.throws(() => assertSchemaSyncAllowed(neon), /refused/);
    assert.throws(() => createDataSource({ url: neon, entities: [], synchronize: true }), /refused on a hosted database/);
    const previous = process.env.DB_TARGET;
    process.env.DB_TARGET = 'hosted';
    try {
      assert.throws(() => createDataSource({ url: 'postgres://u:p@127.0.0.1/db', entities: [], synchronize: true }), /refused/);
      // The runtime configuration (synchronize: false) still works against a hosted target.
      assert.equal(createDataSource({ url: neon, entities: [], synchronize: false }).options.synchronize, false);
    } finally {
      if (previous === undefined) delete process.env.DB_TARGET;
      else process.env.DB_TARGET = previous;
    }
  });
});

for (const service of SERVICES) {
  describe(`${service}-service migrations`, () => {
    test('AC3: sync-db.js refuses DB_TARGET=hosted before changing the database', async () => {
      const db = await emptyDatabase(`${service}_guard`);
      const before = await fingerprint(db.url);
      const result = syncDb(service, db.url, { DB_TARGET: 'hosted' });
      assert.equal(result.code, 1, result.out);
      assert.match(result.out, /db:sync is refused: the database target is hosted/);
      assert.deepEqual(await fingerprint(db.url), before);
      assert.deepEqual(before, {});
    });

    test('the baseline alone reproduces the committed baseline fingerprint exactly', async () => {
      const { baseline } = await load(service);
      const db = await untrackedBaselineCopy(service);
      const diff = compareFingerprints(baseline.schema, await fingerprint(db.url));
      assert.ok(diff.identical, JSON.stringify(diff, null, 2));
    });

    test('an empty database initialised by migrate:run matches the entity schema (db:sync)', async () => {
      const migrated = await emptyDatabase(`${service}_mig`);
      const synced = await emptyDatabase(`${service}_sync`);
      const run = cli(service, migrated.url, ['run']);
      assert.equal(run.code, 0, run.out);
      assert.match(run.out, /Empty database: initialising it from the baseline/);
      const sync = syncDb(service, synced.url);
      assert.equal(sync.code, 0, sync.out);
      const diff = compareFingerprints(await fingerprint(synced.url), await fingerprint(migrated.url));
      assert.ok(diff.identical, JSON.stringify(diff, null, 2));
      // Same default rows (settings, schedule). Timestamp columns default to now() and differ between any two databases.
      const nonTimestamp = Object.fromEntries(Object.entries(await fingerprint(synced.url)).filter(([, v]) => !v.startsWith('timestamp')));
      assert.deepEqual(await dataChecksum(migrated.url, nonTimestamp), await dataChecksum(synced.url, nonTimestamp), 'default rows differ');

      // TypeORM sees the migrated database exactly as it sees a db:sync-built one: the same (usually empty) list of
      // changes it would make. Raw-SQL checks that an entity does not declare (accounts_position_ck) appear in both.
      const { entities } = await import(`../apps/${service}-service/src/lib/entities/index.js`);
      const pendingSync = async (url) => {
        const source = createDataSource({ url, entities, synchronize: false });
        await source.initialize();
        try {
          return (await source.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query).sort();
        } finally {
          await source.destroy();
        }
      };
      assert.deepEqual(await pendingSync(migrated.url), await pendingSync(synced.url));
      const show = cli(service, migrated.url, ['show']);
      assert.match(show.out, /Up to date\./);
    });

    test('AC1: adopting the baseline on an existing copy changes only migration bookkeeping', async () => {
      const { baseline, migrations } = await load(service);
      const db = await untrackedBaselineCopy(service);
      await withClient(db.url, (q) => q.query(SAMPLE_ROWS[service]));
      const schemaBefore = await fingerprint(db.url);
      const dataBefore = await dataChecksum(db.url, schemaBefore);

      // An existing, untracked database is never "initialised": migrate:run refuses and changes nothing.
      const refused = cli(service, db.url, ['run']);
      assert.equal(refused.code, 1, refused.out);
      assert.match(refused.out, /no recorded migrations\. Adopt the baseline first/);
      assert.deepEqual(await withClient(db.url, (q) => q.query('SELECT to_regclass($1) AS t', [MIGRATIONS_TABLE])), [{ t: null }]);

      const check = cli(service, db.url, ['check-baseline']);
      assert.equal(check.code, 0, check.out);
      assert.match(check.out, /matches .* exactly/);

      const adopt = cli(service, db.url, ['baseline']);
      assert.equal(adopt.code, 0, adopt.out);
      assert.match(adopt.out, /no schema or data change/);
      assert.equal(cli(service, db.url, ['baseline']).code, 0, 'adoption is repeatable');

      const show = cli(service, db.url, ['show']);
      assert.match(show.out, new RegExp(`\\[X\\] ${baseline.name}`));
      for (const migration of migrations.slice(1)) assert.match(show.out, new RegExp(`\\[ \\] ${new migration().name}`));

      // Bookkeeping is the only change: identical business schema and identical records.
      assert.deepEqual(await fingerprint(db.url), schemaBefore);
      assert.deepEqual(await dataChecksum(db.url, schemaBefore), dataBefore);
      const rows = await withClient(db.url, (q) => q.query(`SELECT name FROM ${MIGRATIONS_TABLE}`));
      assert.deepEqual(rows, [{ name: baseline.name }]);

      // With only the baseline pending-free, running the remaining migrations changes no existing record.
      const run = cli(service, db.url, ['run']);
      assert.equal(run.code, 0, run.out);
      assert.deepEqual(await dataChecksum(db.url, schemaBefore), dataBefore);
      if (migrations.length === 1) {
        assert.match(run.out, /No pending migrations/);
        assert.deepEqual(await fingerprint(db.url), schemaBefore);
      }
    });

    test('a copy that differs from the baseline is reported and not adopted', async () => {
      const db = await untrackedBaselineCopy(service);
      const table = { identity: 'refresh_tokens', core: 'term_dates', operations: 'tracking_sequences', oversight: 'audit_log' }[service];
      const column = { identity: 'revoked_at', core: 'term_name', operations: 'last_seq', oversight: 'ip_address' }[service];
      await withClient(db.url, (q) => q.query(`ALTER TABLE ${table} DROP COLUMN ${column}`));
      const before = await fingerprint(db.url);
      const check = cli(service, db.url, ['check-baseline']);
      assert.equal(check.code, 1, check.out);
      assert.match(check.out, new RegExp(`missing +column:${table}\\.${column}`));
      const adopt = cli(service, db.url, ['baseline']);
      assert.equal(adopt.code, 1, adopt.out);
      assert.match(adopt.out, /does not match the baseline/);
      assert.deepEqual(await fingerprint(db.url), before);
    });

    test('hosted writes need DB_TARGET=hosted and --confirm=<database>', async () => {
      const db = await emptyDatabase(`${service}_hosted`);
      const noConfirm = cli(service, db.url, ['run'], { DB_TARGET: 'hosted' });
      assert.equal(noConfirm.code, 1);
      assert.match(noConfirm.out, new RegExp(`without --confirm=${db.name}`));
      const wrong = cli(service, db.url, ['run', '--confirm=other_db'], { DB_TARGET: 'hosted' });
      assert.equal(wrong.code, 1);
      assert.deepEqual(await fingerprint(db.url), {});
      const readOnly = cli(service, db.url, ['show'], { DB_TARGET: 'hosted' });
      assert.equal(readOnly.code, 0, readOnly.out);
      assert.ok(!readOnly.out.includes('postgres:postgres'), 'credentials must never be printed');
      const ok = cli(service, db.url, ['run', `--confirm=${db.name}`], { DB_TARGET: 'hosted' });
      assert.equal(ok.code, 0, ok.out);
    });
  });
}

describe('Sprint 5 numbered migrations', () => {
  test('--accept-extra cannot bypass arbitrary extras or incompatible Sprint 5 columns', async () => {
    const db = await untrackedBaselineCopy('identity');
    await withClient(db.url, (q) => q.query('CREATE TABLE unexpected_table (id integer)'));
    let result = cli('identity', db.url, ['baseline', '--accept-extra']);
    assert.equal(result.code, 1, result.out);
    assert.equal(cli('identity', db.url, ['check-baseline']).code, 1);
    await withClient(db.url, (q) => q.query('DROP TABLE unexpected_table; ALTER TABLE accounts ADD COLUMN position text'));
    result = cli('identity', db.url, ['baseline', '--accept-extra']);
    assert.equal(result.code, 1, result.out);
    assert.deepEqual(await withClient(db.url, (q) => q.query('SELECT to_regclass($1) AS t', [MIGRATIONS_TABLE])), [{ t: null }]);
  });

  test('pending migrations reject changed types, defaults, nullability and constraints without repairing them', async () => {
    const db = await untrackedBaselineCopy('identity');
    assert.equal(cli('identity', db.url, ['baseline']).code, 0);
    for (const definition of ['position text', "position varchar(100) DEFAULT 'Staff'", 'position varchar(100) NOT NULL',
      'position varchar(100) CONSTRAINT accounts_position_ck CHECK (position IS NULL)']) {
      await withClient(db.url, (q) => q.query(`ALTER TABLE accounts ADD COLUMN ${definition}`));
      const before = await fingerprint(db.url);
      const result = cli('identity', db.url, ['run']);
      assert.equal(result.code, 1, result.out);
      assert.match(result.out, /Incompatible existing migration objects/);
      assert.deepEqual(await fingerprint(db.url), before);
      await withClient(db.url, (q) => q.query('ALTER TABLE accounts DROP COLUMN position'));
    }
  });
  const columns = (url, table, names) =>
    withClient(url, async (q) =>
      (await q.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2) ORDER BY 1",
        [table, names],
      )).map((r) => r.column_name),
    );

  test('AC2 (Identity CC046): migrate:run adds accounts.position and migrate:revert removes it', async () => {
    const db = await emptyDatabase('identity_ac2');
    assert.equal(cli('identity', db.url, ['run']).code, 0);
    assert.deepEqual(await columns(db.url, 'accounts', ['position']), ['position']);
    revertAfterIdentityCc046(db.url);
    assert.match(cli('identity', db.url, ['revert']).out, /Reverted: Cc046TrimmedPosition1794300400000/);
    const revert = cli('identity', db.url, ['revert']);
    assert.equal(revert.code, 0, revert.out);
    assert.match(revert.out, /Reverted: Cc046AccountPosition1794225600000/);
    assert.deepEqual(await columns(db.url, 'accounts', ['position']), []);
    assert.equal(cli('identity', db.url, ['run']).code, 0);
    assert.deepEqual(await columns(db.url, 'accounts', ['position']), ['position']);
  });

  test('AC2 (Operations CC046, CC050): each revert removes exactly its own columns, newest first', async () => {
    const db = await emptyDatabase('operations_ac2');
    const all = ['disapproval_notice_given', 'disapproval_reason', 'outcome', 'started_by_name', 'started_by_position', 'started_outside_hours'];
    assert.equal(cli('operations', db.url, ['run']).code, 0);
    assert.deepEqual(await columns(db.url, 'transactions', all), all);
    for (const migration of ['Cc045TransactionReceipts1794900200000', 'Cc040QueueTicketLink1794900100000', 'Cc039QueueTickets1794900000000', 'Cc052LateRisk1794531600000', 'Tt1SeedProvenance1794528300000', 'Cc049TransactionEmails1794528200000', 'Cc044RegistryAtStart1794528100000']) {
      assert.ok(cli('operations', db.url, ['revert']).out.includes(`Reverted: ${migration}`));
    }
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc043Registry1794441600000/);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Tt2AnalyticsOutbox1794355200000/);
    assert.deepEqual(await columns(db.url, 'transactions', ['analytics_event_version']), []);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc038ForecastRuns1794300300000/);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc051OutsideHours1794300200000/);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc046StarterName1794300100000/);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc046StartedByPosition1794225600000/);
    assert.deepEqual(await columns(db.url, 'transactions', all), ['disapproval_notice_given', 'disapproval_reason', 'outcome']);
    assert.match(cli('operations', db.url, ['revert']).out, /Reverted: Cc050TransactionOutcome1794182400000/);
    assert.deepEqual(await columns(db.url, 'transactions', all), []);
    const baselineRevert = cli('operations', db.url, ['revert']);
    assert.equal(baselineRevert.code, 1);
    assert.match(baselineRevert.out, /cannot be reverted: it is the starting schema/);
  });

  test('a revert that would delete stored values is refused unless explicitly allowed', async () => {
    const db = await emptyDatabase('identity_loss');
    assert.equal(cli('identity', db.url, ['run']).code, 0);
    await withClient(db.url, (q) =>
      q.query(`INSERT INTO accounts (account_id, employee_no, full_name, email, password_hash, role_key, position)
               VALUES ('00000000-0000-4000-8000-000000000005', 'E-2', 'Sample Admin', 'admin2@example.test', 'x', 'super_admin', 'Registrar')`),
    );
    revertAfterIdentityCc046(db.url);
    assert.match(cli('identity', db.url, ['revert']).out, /Reverted: Cc046TrimmedPosition1794300400000/);
    const refused = cli('identity', db.url, ['revert']);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /would delete values in 1 row\(s\) of accounts \(position\)/);
    assert.deepEqual(await columns(db.url, 'accounts', ['position']), ['position']);
    const allowed = cli('identity', db.url, ['revert'], { CCMS_ALLOW_DATA_LOSS: 'Cc046AccountPosition1794225600000' });
    assert.equal(allowed.code, 0, allowed.out);
    assert.deepEqual(await columns(db.url, 'accounts', ['position']), []);
  });

  test('AC1 (interim script already ran): adoption preserves existing objects and TT2 adds only its declared objects', async () => {
    for (const [service, legacy, fn] of [
      ['identity', '../apps/identity-service/src/lib/migrations/sprint5.js', 'migrateSprint5Identity'],
      ['operations', '../apps/operations-service/src/lib/migrations/sprint5.js', 'migrateSprint5Operations'],
      ['core', '../apps/core-service/src/lib/migrations/sprint5.js', 'migrateSprint5Core'],
    ]) {
      const db = await untrackedBaselineCopy(service);
      await withClient(db.url, (q) => q.query(SAMPLE_ROWS[service]));
      const source = createDataSource({ url: db.url, entities: [], synchronize: false });
      await source.initialize();
      try {
        await (await import(legacy))[fn](source);
        if (service === 'operations') await (await import('../apps/operations-service/src/lib/migrations/sprint6.js')).migrateSprint6Operations(source);
      } finally {
        await source.destroy();
      }
      const schemaBefore = await fingerprint(db.url);
      const dataBefore = await dataChecksum(db.url, schemaBefore);
      const check = cli(service, db.url, ['check-baseline']);
      assert.equal(check.code, 0, check.out);
      assert.match(check.out, /unexpected +column:/);
      const refused = cli(service, db.url, ['baseline']);
      assert.equal(refused.code, 1, refused.out);
      assert.match(refused.out, /--accept-extra/);
      assert.equal(cli(service, db.url, ['baseline', '--accept-extra']).code, 0);
      const constraints = () => withClient(db.url, (q) => q.query("SELECT oid::text, conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY oid"));
      const constraintsBefore = await constraints();
      const run = cli(service, db.url, ['run']);
      assert.equal(run.code, 0, run.out);
      assert.match(run.out, /Applied: Cc/);
      // Verify the legacy-to-TT2 upgrade at that migration boundary.
      if (service === 'identity') revertAfterIdentityCc046(db.url);
      if (service === 'operations') {
        for (const migration of ['Cc045TransactionReceipts1794900200000', 'Cc040QueueTicketLink1794900100000', 'Cc039QueueTickets1794900000000', 'Cc052LateRisk1794531600000', 'Tt1SeedProvenance1794528300000', 'Cc049TransactionEmails1794528200000', 'Cc044RegistryAtStart1794528100000', 'Cc043Registry1794441600000']) {
          assert.ok(cli(service, db.url, ['revert']).out.includes(`Reverted: ${migration}`));
        }
      }
      if (service === 'core') {
        assert.match(cli(service, db.url, ['revert']).out, /Reverted: Cc047AllowedClientTypes1794528000000/);
        assert.match(cli(service, db.url, ['revert']).out, /Reverted: Cc058CalendarReasons1794441700000/);
      }
      // Only the TT2 objects (a later, additive migration) are new; every Sprint 5 object is unchanged.
      const tt2 = service === 'operations' ? (await import('../apps/operations-service/migrations/tt2-analytics-schema.json', { with: { type: 'json' } })).default : {};
      assert.deepEqual(await fingerprint(db.url), { ...schemaBefore, ...tt2 }, `${service}: business schema changed`);
      assert.deepEqual(await dataChecksum(db.url, schemaBefore), dataBefore, `${service}: business data changed`);
      const existingNames = new Set(constraintsBefore.map((constraint) => constraint.conname));
      const existingAfter = (await constraints()).filter((constraint) => existingNames.has(constraint.conname));
      // TT2 legitimately adds its own constraints; every pre-existing constraint must retain its original OID.
      // The complete fingerprint assertion above separately restricts every new object to the declared TT2 schema.
      assert.deepEqual(existingAfter, constraintsBefore, `${service}: existing constraints were recreated`);
    }
  });
});
