import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { Office } from '../src/lib/entities/index.js';
import { setOfficeBackdatePermission, toOfficeDto } from '../src/lib/catalogue/offices.js';
import { S853OfficeBackdatePermission1795478500000 } from '../migrations/1795478500000-S853OfficeBackdatePermission.js';

const admin = { id: 'admin', role: ROLES.SUPER_ADMIN };
function fixture({ auditFails = false } = {}) {
  let saved = { officeId: 'office', officeCode: 'OFF', officeName: 'Office', isActive: true, allowBackdatedTransactions: false };
  const events = [];
  let locks = 0;
  return {
    state: () => saved, events, locks: () => locks,
    db: { transaction: async (fn) => {
      const next = { ...saved }, pending = [];
      const manager = {
        query: async (sql, params) => {
          assert.match(sql, /FOR UPDATE/); assert.deepEqual(params, ['office']); locks++; return [];
        },
        getRepository: (entity) => {
          assert.equal(entity, Office);
          return { findOneBy: async () => ({ ...next }), update: async (_id, patch) => Object.assign(next, patch) };
        },
        createQueryBuilder: () => {
          const builder = { insert: () => builder, into: () => builder, values: (value) => { pending.push(value.payload); return builder; },
            orIgnore: () => builder, execute: async () => { if (auditFails) throw new Error('Audit unavailable'); } };
          return builder;
        },
      };
      const result = await fn(manager);
      saved = next; events.push(...pending); return result;
    } },
  };
}

test('S8-53 office schema and DTO default to off; migration defaults all existing offices off', async () => {
  assert.equal(Office.options.columns.allowBackdatedTransactions.default, false);
  assert.equal(toOfficeDto({}).allow_backdated_transactions, false);
  let sql;
  await new S853OfficeBackdatePermission1795478500000().up({ query: async (value) => { sql = value; } });
  assert.match(sql, /boolean NOT NULL DEFAULT false/);
});
test('S8-53 only Super Admin can change the setting and the boolean input is strict', async () => {
  for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
    await assert.rejects(setOfficeBackdatePermission({}, { role }, 'office', { allow_backdated_transactions: true }), (e) => e.status === 403);
  }
  for (const input of [null, {}, { allow_backdated_transactions: 'true' }, { allow_backdated_transactions: 1 },
    { allow_backdated_transactions: true, office_id: 'other' }]) {
    await assert.rejects(setOfficeBackdatePermission({}, admin, 'office', input), (e) => e.status === 400);
  }
});
test('S8-53 each actual change is locked and audited with actor, office, before/after and IP; repeats are no-ops', async () => {
  const f = fixture();
  for (const allowed of [true, true, false]) {
    const response = await setOfficeBackdatePermission(f.db, admin, 'office', { allow_backdated_transactions: allowed }, { ipAddress: '127.0.0.1' });
    assert.equal(response.allow_backdated_transactions, allowed);
  }
  assert.equal(f.locks(), 3);
  assert.equal(f.events.length, 2);
  assert.deepEqual(f.events.map((e) => [e.before_value.allow_backdated_transactions, e.after_value.allow_backdated_transactions]), [[false, true], [true, false]]);
  assert.equal(f.events[0].action, 'OFFICE_BACKDATE_PERMISSION_CHANGED');
  assert.equal(f.events[0].actor_user_id, 'admin');
  assert.equal(f.events[0].office_id, 'office');
  assert.equal(f.events[0].ip_address, '127.0.0.1');
});
test('S8-53 a failed audit rolls the permission change back', async () => {
  const f = fixture({ auditFails: true });
  await assert.rejects(setOfficeBackdatePermission(f.db, admin, 'office', { allow_backdated_transactions: true }), /Audit unavailable/);
  assert.equal(f.state().allowBackdatedTransactions, false);
  assert.equal(f.events.length, 0);
});
