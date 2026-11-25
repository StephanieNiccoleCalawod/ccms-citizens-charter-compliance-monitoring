// A person can delete a notice: it stays gone for that person only, and it is not a "read" mark. The database is real.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as listRoute } from '../src/app/api/analytics/notifications/route.js';
import { POST as readRoute } from '../src/app/api/analytics/notifications/read/route.js';
import { POST as deleteRoute } from '../src/app/api/analytics/notifications/delete/route.js';
import { OFFICE_A, call, req, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => { await env?.teardown(); });
beforeEach(async () => {
  await env.ds.query('DELETE FROM notification_reads');
  await env.ds.query('DELETE FROM complaints');
});

async function resolved(ref) {
  const id = randomUUID();
  const at = new Date(Date.now() - 2 * 3600_000).toISOString();
  await env.ds.query(
    `INSERT INTO complaints (complaint_id, reference, office_id, category, description, complainant_name, complainant_email, status, created_at, acknowledged_at, resolved_at, reply)
     VALUES ($1,$2,$3,'DELAYED_SERVICE','Waited.', 'Ana Citizen', 'ana@example.com', 'RESOLVED', $4, $4, $4, 'Done.')`, [id, ref, OFFICE_A, at]);
  return id;
}
const list = (token) => call(listRoute, req('GET', '/analytics/notifications', { token }));
const del = (token, body) => call(deleteRoute, req('POST', '/analytics/notifications/delete', { token, body }));

describe('delete a notice', () => {
  it('needs a token, and the Executive has no bell', async () => {
    assert.equal((await call(deleteRoute, req('POST', '/analytics/notifications/delete', { body: { keys: ['calendar:x'] } }))).status, 401);
    assert.equal((await del(tokens.executive, { keys: ['calendar:x'] })).status, 403);
  });

  it('a deleted notice no longer shows for that person, and is not counted as read', async () => {
    const id = await resolved('CMP-D1');
    const before = await list(tokens.officeHeadA);
    assert.ok(before.body.items.some((i) => i.key === `complaint:${id}:RESOLVED`));
    const res = await del(tokens.officeHeadA, { keys: [`complaint:${id}:RESOLVED`] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deleted: 1 });
    const after = await list(tokens.officeHeadA);
    assert.ok(!after.body.items.some((i) => i.key.startsWith(`complaint:${id}`) && i.key.endsWith('RESOLVED')));
    assert.deepEqual(after.body.deleted_keys, [`complaint:${id}:RESOLVED`]);
    assert.ok(!after.body.read_keys.some((k) => k.startsWith('deleted:')));
  });

  it('it is per person: another user still sees the notice', async () => {
    const id = await resolved('CMP-D2');
    await del(tokens.officeHeadA, { keys: [`complaint:${id}:RESOLVED`] });
    const other = await list(tokens.superAdmin);
    assert.ok(other.body.items.some((i) => i.key === `complaint:${id}:RESOLVED`));
  });

  it('deleting the same key twice is fine, and a read mark of the same key stays separate', async () => {
    const key = `complaint:${await resolved('CMP-D3')}:RESOLVED`;
    assert.equal((await call(readRoute, req('POST', '/analytics/notifications/read', { token: tokens.officeHeadA, body: { keys: [key] } }))).status, 200);
    assert.equal((await del(tokens.officeHeadA, { keys: [key] })).status, 200);
    assert.equal((await del(tokens.officeHeadA, { keys: [key] })).status, 200);
    const rows = await env.ds.query('SELECT notification_key FROM notification_reads ORDER BY 1');
    assert.equal((Array.isArray(rows[0]) ? rows[0] : rows).length, 2);
  });

  it('refuses a bad body, and a key that already starts with "deleted:"', async () => {
    for (const body of [undefined, {}, { keys: [] }, { keys: ['no spaces here'] }, { keys: ['deleted:calendar:x'] }, { keys: ['calendar:' + 'x'.repeat(151)] }, { keys: Array.from({ length: 201 }, (_, i) => `calendar:${i}`) }]) {
      assert.equal((await del(tokens.officeHeadA, body)).status, 400, JSON.stringify(body)?.slice(0, 60));
    }
  });
});
