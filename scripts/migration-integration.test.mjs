import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestDatabase, DEFAULT_TEST_PG_URL } from 'ccms-shared/testing';
import { schemaFingerprint } from 'ccms-shared';
import { Cc048OfficeSchedules1794300000000 } from '../apps/core-service/migrations/1794300000000-Cc048OfficeSchedules.js';
import { Cc038ForecastRuns1794300300000 } from '../apps/operations-service/migrations/1794300300000-Cc038ForecastRuns.js';
import { Cc046TrimmedPosition1794300400000 } from '../apps/identity-service/migrations/1794300400000-Cc046TrimmedPosition.js';

if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.TEST_PG_URL ?? DEFAULT_TEST_PG_URL).hostname)) {
  throw new Error('Integration migration tests require a disposable loopback database');
}
async function database(service, fn) {
  const { migrations } = await import(`../apps/${service}-service/migrations/index.js`);
  const db = await createTestDatabase({ entities: [] });
  try {
    for (const Migration of migrations) await new Migration().up(db.dataSource);
    await fn(db.dataSource);
  } finally { await db.drop(); }
}
test('new office tables revert when empty and refuse reversal after schedules are saved', async () => {
  await database('core', async (source) => {
    const migration = new Cc048OfficeSchedules1794300000000();
    await migration.down(source);
    assert.equal((await source.query("SELECT to_regclass('office_schedules') AS t"))[0].t, null);
    await migration.up(source);
    await source.query("INSERT INTO offices(office_id,office_code,office_name) VALUES ('00000000-0000-4000-8000-000000000001','REG','Registrar')");
    await source.query("INSERT INTO office_schedules(office_id,weekday) VALUES ('00000000-0000-4000-8000-000000000001',1)");
    await assert.rejects(migration.down(source), /would delete 1 row/);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM office_schedules'))[0].n, 1);
  });
});
test('partial office tables are refused instead of silently accepted or repaired', async () => {
  const db = await createTestDatabase({ entities: [] });
  try {
    await db.dataSource.query('CREATE TABLE office_schedules(office_id uuid)');
    const before = await schemaFingerprint(db.dataSource);
    await assert.rejects(new Cc048OfficeSchedules1794300000000().up(db.dataSource), /Partial existing/);
    assert.deepEqual(await schemaFingerprint(db.dataSource), before);
  } finally { await db.drop(); }
});
test('forecast storage retains its UUID default and refuses data-loss and incomplete-index replays', async () => {
  await database('operations', async (source) => {
    const migration = new Cc038ForecastRuns1794300300000();
    const [row] = await source.query("INSERT INTO forecast_runs(office_id,selected_model) VALUES ('00000000-0000-4000-8000-000000000001','NONE') RETURNING id");
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    await assert.rejects(migration.down(source), /would delete 1 row/);
    await source.query('DROP INDEX forecast_runs_office_idx');
    const before = await schemaFingerprint(source);
    await assert.rejects(migration.up(source), /Incompatible existing migration object/);
    assert.deepEqual(await schemaFingerprint(source), before);
  });
});
test('stricter position rules never silently trim existing account records', async () => {
  await database('identity', async (source) => {
    const migration = new Cc046TrimmedPosition1794300400000();
    await migration.down(source);
    await source.query("INSERT INTO accounts(account_id,employee_no,full_name,email,password_hash,role_key,position) VALUES ('00000000-0000-4000-8000-000000000001','E1','Example','example@example.test','x','super_admin',' Staff ')");
    const before = await schemaFingerprint(source);
    await assert.rejects(migration.up(source), /no records were changed/);
    assert.equal((await source.query('SELECT position FROM accounts'))[0].position, ' Staff ');
    assert.deepEqual(await schemaFingerprint(source), before);
  });
});
