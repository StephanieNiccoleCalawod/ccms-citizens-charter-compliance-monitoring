// Sprint 7 CC055: the Oversight half of the notification bell. The database is real.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as listRoute } from '../src/app/api/notifications/route.js';
import { POST as readRoute } from '../src/app/api/notifications/read/route.js';
import { OFFICE_A, OFFICE_B, USERS, call, req, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => { await env?.teardown(); });
beforeEach(async () => {
  await env.ds.query('DELETE FROM notification_reads');
  await env.ds.query("DELETE FROM audit_log WHERE entity_type = 'calendar_exception'");
  await env.ds.query('DELETE FROM complaints');
  switchState.STAFF_VIEW_COMPLAINTS = false;
});

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
async function resolved(officeId, ref, at = hoursAgo(2)) {
  const id = randomUUID();
  await env.ds.query(
    `INSERT INTO complaints (complaint_id, reference, office_id, category, description, complainant_name, complainant_email, status, created_at, acknowledged_at, resolved_at, reply)
     VALUES ($1,$2,$3,'DELAYED_SERVICE','Waited.', 'Ana Citizen', 'ana@example.com', 'RESOLVED', $4, $4, $4, 'Done.')`, [id, ref, officeId, at]);
  return id;
}
async function calendar(officeId, action = 'CALENDAR_EXCEPTION_ADDED', at = hoursAgo(1)) {
  const id = randomUUID();
  await env.ds.query(
    `INSERT INTO audit_log (audit_id, actor_user_id, actor_role, action, entity_type, entity_id, office_id, after_value, occurred_at)
     VALUES ($1,$2,'super_admin',$3,'calendar_exception',$4,$5,$6::jsonb,$7)`, [id, USERS.adminId, action, randomUUID(), officeId, JSON.stringify({ exception_type: 'SUSPENSION', exception_date: '2026-11-20' }), at]);
  return id;
}
const list = (token) => call(listRoute, req('GET', '/notifications', { token }));
const mark = (token, body) => call(readRoute, req('POST', '/notifications/read', { token, body }));

describe('access', () => {
  it('no token is 401 and the Executive has no bell (403)', async () => {
    assert.equal((await call(listRoute, req('GET', '/notifications'))).status, 401);
    assert.equal((await list(tokens.executive)).status, 403);
    assert.equal((await mark(tokens.executive, { keys: ['calendar:x'] })).status, 403);
  });
});

describe('feed', () => {
  it('shows complaint changes and calendar events of the office, newest first, without the citizen\'s details', async () => {
    await resolved(OFFICE_A, 'CMP-A1');
    await resolved(OFFICE_B, 'CMP-B1');
    await calendar(OFFICE_A);
    await calendar(null, 'CALENDAR_EXCEPTION_UPDATED', hoursAgo(3));
    await calendar(OFFICE_B);
    switchState.STAFF_VIEW_COMPLAINTS = true;
    const res = await list(tokens.officeHeadA);
    assert.equal(res.status, 200);
    const texts = res.body.items.map((i) => i.text);
    assert.ok(texts.some((t) => t.includes('CMP-A1 was resolved')));
    assert.ok(!texts.some((t) => t.includes('CMP-B1')));
    assert.equal(res.body.items.filter((i) => i.kind === 'CALENDAR').length, 2);
    assert.ok(texts.some((t) => t.includes('whole campus')));
    assert.ok(!JSON.stringify(res.body).includes('Ana Citizen') && !JSON.stringify(res.body).includes('ana@example.com'));
    const times = res.body.items.map((i) => i.at);
    assert.deepEqual(times, [...times].sort().reverse());
  });
  it('Super Admin sees every office', async () => {
    await resolved(OFFICE_A, 'CMP-A1');
    await resolved(OFFICE_B, 'CMP-B1');
    const refs = (await list(tokens.superAdmin)).body.items.map((i) => i.text).join(' ');
    assert.match(refs, /CMP-A1/); assert.match(refs, /CMP-B1/);
  });
  it('Office Staff see complaint notices only while STAFF_VIEW_COMPLAINTS is on; calendar notices always', async () => {
    await resolved(OFFICE_A, 'CMP-A1');
    await calendar(OFFICE_A);
    let items = (await list(tokens.officeStaffA)).body.items;
    assert.ok(!items.some((i) => i.kind === 'COMPLAINT'));
    assert.ok(items.some((i) => i.kind === 'CALENDAR'));
    switchState.STAFF_VIEW_COMPLAINTS = true;
    items = (await list(tokens.officeStaffA)).body.items;
    assert.ok(items.some((i) => i.kind === 'COMPLAINT'));
  });
  it('leaves out anything older than 7 days', async () => {
    await resolved(OFFICE_A, 'CMP-OLD', hoursAgo(24 * 8));
    await calendar(OFFICE_A, 'CALENDAR_EXCEPTION_ADDED', hoursAgo(24 * 8));
    assert.equal((await list(tokens.superAdmin)).body.items.length, 0);
  });
  it('is empty when nothing happened', async () => {
    const res = await list(tokens.officeHeadA);
    assert.deepEqual(res.body.items, []);
  });
});

describe('read marks', () => {
  it('are per user, repeatable, and shown on the next read', async () => {
    const id = await calendar(OFFICE_A);
    const key = `calendar:${id}`;
    assert.equal((await mark(tokens.officeHeadA, { keys: [key, key] })).body.marked, 1);
    assert.equal((await mark(tokens.officeHeadA, { keys: [key] })).status, 200);
    assert.equal((await list(tokens.officeHeadA)).body.items.find((i) => i.key === key).read, true);
    assert.equal((await list(tokens.officeStaffA)).body.items.find((i) => i.key === key).read, false);
    assert.deepEqual((await list(tokens.officeHeadA)).body.read_keys, [key]);
  });
  it('accept keys for notices that come from Operations, and refuse bad input', async () => {
    assert.equal((await mark(tokens.officeHeadA, { keys: ['overdue:11111111-1111-1111-1111-111111111111'] })).status, 200);
    for (const body of [{}, { keys: [] }, { keys: 'x' }, { keys: [1] }, { keys: ['bad key with spaces'] }, { keys: ['a'.repeat(201)] }, { keys: Array(201).fill('a:b') }]) {
      assert.equal((await mark(tokens.officeHeadA, body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
  });
  it('marks older than 30 days are removed on the next write', async () => {
    await env.ds.query("INSERT INTO notification_reads (user_id, notification_key, read_at) VALUES ($1,'overdue:old', now() - interval '31 days')", [USERS.headA]);
    await mark(tokens.officeHeadA, { keys: ['overdue:new'] });
    const keys = (await env.ds.query('SELECT notification_key FROM notification_reads WHERE user_id = $1', [USERS.headA])).map((r) => r.notification_key);
    assert.deepEqual(keys, ['overdue:new']);
  });
});

describe('database access', () => {
  it('the running role may read, add and remove read marks, but not change them', async () => {
    const { default: pg } = await import('pg');
    const { roleUrl } = await import('./helpers.js');
    const client = new pg.Client({ connectionString: roleUrl(env.url, 'ccms_logs_writer') });
    await client.connect();
    try {
      await client.query("INSERT INTO notification_reads (user_id, notification_key) VALUES ($1, 'x:y')", [randomUUID()]);
      await client.query('SELECT * FROM notification_reads');
      await client.query("DELETE FROM notification_reads WHERE notification_key = 'x:y'");
      await assert.rejects(client.query("UPDATE notification_reads SET read_at = now()"), { code: '42501' });
    } finally { await client.end(); }
  });
});
