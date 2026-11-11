import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { createDataSource, ROLES, setDataSource, setDefaultVerifier } from 'ccms-shared';
import { createTestKeys, DEFAULT_TEST_PG_URL } from 'ccms-shared/testing';
import { migrations as operationsMigrations } from '../apps/operations-service/migrations/index.js';
import { entities as operationsEntities } from '../apps/operations-service/src/lib/entities/index.js';
import { GET as history, POST as upload } from '../apps/operations-service/src/app/api/registry/imports/route.js';
import { GET as summary } from '../apps/operations-service/src/app/api/registry/summary/route.js';
import { migrations as coreMigrations } from '../apps/core-service/migrations/index.js';
import { entities as coreEntities } from '../apps/core-service/src/lib/entities/index.js';
import { createException, updateException } from '../apps/core-service/src/lib/calendar/exceptions.js';
import { isWorkingDay } from '../apps/core-service/src/lib/calendar/engine-service.js';
import { buildDeclarations } from '../apps/core-service/src/lib/calendar/declarations.js';
import { buildTermSnapshot } from '../apps/core-service/src/lib/calendar/sms-snapshot.js';
import { computeKpis, getStartKpis } from '../apps/oversight-service/src/modules/analytics/kpi.js';

const adminUrl = process.env.TEST_PG_URL ?? DEFAULT_TEST_PG_URL;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname)) {
  throw new Error('Sprint 5 feature tests require a disposable loopback database.');
}
const sources = [];
const databases = [];
const migrateOptions = { transaction: 'each' };
const fixtureDir = process.env.CCMS_REGISTRY_FIXTURES;
const header = 'student_number,full_name,program,year_level,status,valid_until,email\n';
const csv = (records) => new File([header, records], 'registry.csv', { type: 'text/csv' });
const firstStudent = 'MOCK-001,Mock Student,BSIT,2,ENROLLED,12/12/2026,mock@example.test';

async function admin(sql) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function database(entities, migrations) {
  const name = `ccms_s5_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  databases.push(name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const source = createDataSource({ url: url.toString(), entities, migrations, synchronize: false });
  sources.push(source);
  return source.initialize();
}

after(async () => {
  setDataSource(null);
  setDefaultVerifier(null);
  for (const source of sources) if (source.isInitialized) await source.destroy();
  for (const name of databases) await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
});

async function fixture(kind, extension) {
  const name = `CCMS - REGISTRY ${kind} (11082026).${extension}`;
  return new File([await readFile(join(fixtureDir, name))], name);
}

describe('CC043 registry API with the numbered Operations migrations', () => {
  let db;
  let adminToken;
  let headToken;
  let staffToken;
  let executiveToken;
  before(async () => {
    db = await database(operationsEntities, operationsMigrations);
    await db.runMigrations(migrateOptions);
    setDataSource(db);
    const keys = await createTestKeys();
    setDefaultVerifier(keys.verifier);
    adminToken = await keys.signToken({ role: ROLES.SUPER_ADMIN });
    headToken = await keys.signToken({ role: ROLES.OFFICE_HEAD, office_id: randomUUID() });
    staffToken = await keys.signToken({ role: ROLES.OFFICE_STAFF, office_id: randomUUID() });
    executiveToken = await keys.signToken({ role: ROLES.EXECUTIVE });
  });

  const read = (handler, token = adminToken) => handler(new Request('http://localhost/api/registry', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));
  function send(file, dryRun = false, token = adminToken) {
    const body = new FormData();
    body.set('file', file);
    body.set('dryRun', String(dryRun));
    return upload(new Request('http://localhost/api/registry/imports', {
      method: 'POST', body, headers: token ? { authorization: `Bearer ${token}` } : {},
    }));
  }

  test('the new migration can be reverted and reapplied before imports exist', async () => {
    await db.undoLastMigration(migrateOptions);
    assert.equal((await db.query("SELECT to_regclass('registry_people') AS name"))[0].name, null);
    const applied = await db.runMigrations(migrateOptions);
    assert.deepEqual(applied.map(({ name }) => name), ['Cc043Registry1794441600000']);
    assert.deepEqual(await db.runMigrations(migrateOptions), []);
  });

  test('all registry routes enforce the Super Admin role', async () => {
    assert.equal((await send(csv(firstStudent), false, null)).status, 401);
    for (const token of [headToken, staffToken, executiveToken]) {
      assert.equal((await send(csv(firstStudent), false, token)).status, 403);
      assert.equal((await read(history, token)).status, 403);
      assert.equal((await read(summary, token)).status, 403);
    }
  });

  test('dry run writes nothing, invalid imports are atomic, and repeat imports update only changed rows', async () => {
    const check = await send(csv(firstStudent), true);
    assert.equal(check.status, 200);
    assert.equal((await check.json()).added, 1);
    assert.equal((await (await read(history)).json()).total, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_outbox'))[0].n, 0);
    const rejected = await send(csv(firstStudent + '\n,Invalid Row,BSIT,1,ENROLLED,12/12/2026,'));
    assert.equal(rejected.status, 400);
    assert.deepEqual((await rejected.json()).error.details.errors.map(({ row }) => row), [3]);
    assert.equal((await (await read(summary)).json()).total, 0);
    assert.equal((await (await read(history)).json()).total, 0);

    assert.equal((await send(csv(firstStudent + '\nMOCK-002,Mock Alumni,BSIT,,ALUMNI,,'))).status, 201);
    const same = await (await send(csv(firstStudent))).json();
    assert.deepEqual([same.added, same.updated, same.unchanged], [0, 0, 1]);
    const changed = await (await send(csv(firstStudent.replace('Mock Student', 'Updated Mock')))).json();
    assert.deepEqual([changed.added, changed.updated, changed.unchanged], [0, 1, 0]);
    const totals = await (await read(summary)).json();
    assert.deepEqual([totals.total, totals.enrolled, totals.alumni], [2, 1, 1]);
    const [row] = await db.query("SELECT full_name FROM registry_people WHERE student_number = 'MOCK-001'");
    assert.equal(row.full_name, 'Updated Mock');
    const audit = await db.query("SELECT payload FROM audit_outbox WHERE payload->>'action' = 'REGISTRY_IMPORTED'");
    assert.equal(audit.length, 3);
    const values = audit.map(({ payload }) => payload.after_value);
    assert.ok(values.some((value) => value.rows === 1 && value.updated === 1 && value.added === 0));
    for (const value of values) assert.deepEqual(Object.keys(value).sort(), ['added', 'rows', 'updated']);
    await assert.rejects(db.undoLastMigration(migrateOptions), /would delete/i);
  });

  test('limits oversized and over-row-count uploads before saving', async () => {
    const limit = 4 * 1024 * 1024;
    const row = `${firstStudent}\n`;
    const atLimit = csv(row + '\n'.repeat(limit - Buffer.byteLength(header + row)));
    assert.equal(atLimit.size, limit);
    assert.equal((await send(atLimit, true)).status, 200);
    for (const name of ['big.csv', 'big.xlsx']) {
      const big = new File([atLimit, '\n'], name);
      const rejected = await send(big);
      assert.equal(rejected.status, 413);
      const { error } = await rejected.json();
      assert.equal(error.code, 'REGISTRY_FILE_TOO_LARGE');
      assert.match(error.message, /4 MB/);
    }
    const many = csv(`${firstStudent}\n`.repeat(10_001));
    const response = await send(many);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /10,000/);
  });

  test('the supplied CSV and XLSX mock files satisfy the import criteria', { skip: !fixtureDir }, async () => {
    const enrolledCsv = await fixture('MOCK STUDENTS 2350', 'csv');
    const result = await send(enrolledCsv);
    assert.equal(result.status, 201);
    assert.equal((await result.json()).added, 2350);
    const sameXlsx = await send(await fixture('MOCK STUDENTS 2350', 'xlsx'));
    assert.equal(sameXlsx.status, 201);
    const repeat = await sameXlsx.json();
    assert.deepEqual([repeat.added, repeat.updated, repeat.unchanged], [0, 0, 2350]);
    const alumni = await send(await fixture('MOCK ALUMNI 1200', 'xlsx'));
    assert.equal(alumni.status, 201);
    assert.equal((await alumni.json()).added, 1200);
    const before = await (await read(summary)).json();
    const previousHistory = await (await read(history)).json();
    for (const extension of ['csv', 'xlsx']) {
      const rejected = await send(await fixture('QA INVALID ROWS 12', extension));
      assert.equal(rejected.status, 400);
      const { errors } = (await rejected.json()).error.details;
      assert.deepEqual(errors.map(({ row }) => row), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    }
    assert.deepEqual(await (await read(summary)).json(), before);
    assert.deepEqual(await (await read(history)).json(), previousHistory);
  });
});

describe('CC058 calendar metadata and the existing integration contract', () => {
  const actor = { id: randomUUID(), role: ROLES.SUPER_ADMIN };
  const day = '2026-10-06';
  const base = { exception_date: day, exception_type: 'SUSPENSION', suspended_from: '12:00', suspended_until: '13:00' };
  let db;
  before(async () => {
    db = await database(coreEntities, coreMigrations.slice(0, -1));
    await db.runMigrations(migrateOptions);
    await db.query(
      "INSERT INTO calendar_exceptions (exception_id, exception_date, exception_type) VALUES ($1, '2026-10-07', 'REGULAR_HOLIDAY')",
      [randomUUID()],
    );
    const calendarMigration = coreMigrations.at(-1);
    db.migrations.push(new calendarMigration());
    await db.runMigrations(migrateOptions);
  });

  test('existing entries get OTHER and manual creates require a category', async () => {
    const [old] = await db.query('SELECT reason_category, reference FROM calendar_exceptions');
    assert.deepEqual(old, { reason_category: 'OTHER', reference: null });
    await assert.rejects(createException(db, actor, base), (error) => error.status === 400 && Boolean(error.details.reason_category));
  });

  test('metadata survives edits and neither the working intervals nor the wire entries change', async () => {
    const saved = await createException(db, actor, { ...base, reason_category: 'HEAT_INDEX' });
    assert.equal(saved.reference, null);
    const range = { from: day, to: day };
    const term = { term_name: '2026-1S', start_date: day, end_date: day };
    const fms = await buildDeclarations(db, range);
    const scms = (await buildTermSnapshot(db, term)).items;
    assert.ok(fms.length > 0 && scms.length > 0);
    const initial = await isWorkingDay(db, { date: day, includeIntervals: true });
    assert.equal(initial.working_intervals.length, 2);
    assert.equal(initial.working_intervals[0].closing_time, '12:00');
    assert.equal(initial.working_intervals[1].opening_time, '13:00');
    const amended = await updateException(db, actor, saved.exception_id, { ...base, reference: '  Memo 2026-01  ' });
    assert.equal(amended.reason_category, 'HEAT_INDEX');
    assert.equal(amended.reference, 'Memo 2026-01');
    assert.equal(amended.revision, saved.revision);
    assert.deepEqual(await isWorkingDay(db, { date: day, includeIntervals: true }), initial);
    assert.deepEqual(await buildDeclarations(db, range), fms);
    assert.deepEqual((await buildTermSnapshot(db, term)).items, scms);
    assert.doesNotMatch(JSON.stringify([fms, scms]), /reason_category|HEAT_INDEX|Memo 2026-01/);
  });
});

test('CC051 KPI counts use Manila start dates and enforce office scope', async () => {
  const office = randomUUID();
  const other = randomUUID();
  const rows = [
    { office_id: office, started_at: '2026-10-05T16:00:00Z', started_outside_hours: true },
    { office_id: office, started_at: '2026-10-06T15:59:00Z', is_backdated: true, started_outside_hours: true },
    { office_id: office, started_at: '2026-10-06T16:00:00Z', started_outside_hours: true },
    { office_id: other, started_at: '2026-10-06T07:00:00Z', started_outside_hours: true },
  ];
  const { totals } = computeKpis(rows, { officeId: office, from: '2026-10-06', to: '2026-10-06' });
  assert.deepEqual(totals, { received: 2, backdated: 1, started_outside_hours: 1 });
  await assert.rejects(
    getStartKpis({ query: () => assert.fail('Cross-office reads must stop before querying') },
      { role: ROLES.OFFICE_HEAD, officeId: office }, new URLSearchParams({ office_id: other })),
    (error) => error.status === 403,
  );
});
