import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestDatabase } from 'ccms-shared/testing';
import { S858CharterFeeBackfill1795852800000 } from '../migrations/1795852800000-S858CharterFeeBackfill.js';

describe('S8-58 approved fee backfill', () => {
  let testDb;
  let db;
  const migration = new S858CharterFeeBackfill1795852800000();
  const fixtures = [
    ['blank', null, true], ['none', '\t NONE \n', true],
    ['PUP-REG-CRD-005', 'NONE (covered by RA 10931)', true],
    ['PUP-ACCT-CLR-001', 'None. See other fees below.', false],
    ['PUP-ADMREG-ACC-003', 'From another college: PHP 12 per unit', false],
    ['PUP-ADMREG-ADM-001', 'Placement test: PHP 150', false],
    ['paid', 'PHP 150', true], ['inactive', 'None', true, false],
    ['override', 'None', true], ['unchanged-edit', 'None', true],
  ];

  before(async () => {
    testDb = await createTestDatabase({ entities: [] });
    db = testDb.dataSource;
    await db.query(`CREATE TABLE services (
      service_id uuid PRIMARY KEY, office_id uuid, service_code text, service_name text,
      fees text, has_fee boolean NOT NULL, is_active boolean NOT NULL)`);
    await db.query('CREATE TABLE audit_outbox (audit_id uuid PRIMARY KEY, payload jsonb NOT NULL)');
  });
  after(async () => { await testDb?.drop(); });
  beforeEach(async () => {
    await db.query('TRUNCATE services, audit_outbox');
    for (const [code, fees, flag, active = true] of fixtures) {
      await db.query('INSERT INTO services VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), randomUUID(), code, code, fees, flag, active]);
    }
    const [overridden] = await db.query("SELECT service_id FROM services WHERE service_code='override'");
    const [unchanged] = await db.query("SELECT service_id FROM services WHERE service_code='unchanged-edit'");
    for (const [id, before] of [[overridden.service_id, false], [unchanged.service_id, true]]) {
      await db.query('INSERT INTO audit_outbox VALUES ($1,$2)', [randomUUID(), {
        action: 'SERVICE_UPDATED', actor_role: 'super_admin', entity_id: id,
        before_value: { has_fee: before }, after_value: { has_fee: true },
      }]);
    }
  });

  it('classifies the approved services and audits every actual change while preserving overrides and inactive rows', async () => {
    await db.transaction((manager) => migration.up(manager));
    const rows = await db.query('SELECT service_code, has_fee, fees FROM services');
    const flags = Object.fromEntries(rows.map((r) => [r.service_code, r.has_fee]));
    assert.deepEqual(flags, {
      blank: false, none: false, 'PUP-REG-CRD-005': false, 'PUP-ACCT-CLR-001': true,
      'PUP-ADMREG-ACC-003': true, 'PUP-ADMREG-ADM-001': true, paid: true,
      inactive: true, override: true, 'unchanged-edit': false,
    });
    for (const [code, fees] of fixtures) assert.equal(rows.find((r) => r.service_code === code).fees, fees);
    const audit = await db.query("SELECT payload FROM audit_outbox WHERE payload->'after_value'->>'reason'='D-AC-7 Charter fee backfill approved by PM'");
    assert.equal(audit.length, 7);
    for (const { payload } of audit) {
      assert.notEqual(payload.before_value.has_fee, payload.after_value.has_fee);
      assert.equal(payload.actor_user_id, '00000000-0000-0000-0000-000000000000');
    }
    await db.transaction((manager) => migration.up(manager));
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM audit_outbox');
    assert.equal(count, 9);
    await migration.down();
    assert.deepEqual(await db.query('SELECT service_code, has_fee, fees FROM services'), rows);
  });

  it('rolls fee changes and audit events back together after a failed migration', async () => {
    const beforeRows = await db.query('SELECT * FROM services ORDER BY service_id');
    await assert.rejects(db.transaction(async (manager) => {
      await migration.up(manager);
      throw new Error('Rollback fixture');
    }), /Rollback fixture/);
    assert.deepEqual(await db.query('SELECT * FROM services ORDER BY service_id'), beforeRows);
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM audit_outbox');
    assert.equal(count, 2);
  });
});
