// Sprint 7 CC034 / CC035: handling complaints. Core (deadline) is a stand-in; the database is real.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as listRoute } from '../src/app/api/complaints/route.js';
import { GET as oneRoute } from '../src/app/api/complaints/[id]/route.js';
import { POST as ackRoute } from '../src/app/api/complaints/[id]/acknowledge/route.js';
import { POST as resolveRoute } from '../src/app/api/complaints/[id]/resolve/route.js';
import { coreDeadline, isOverdue, setDeadlineProvider } from '../src/modules/complaints/handling.js';
import { OFFICE_A, OFFICE_B, call, req, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
let due;
before(async () => { env = await setupTestEnv(); });
after(async () => { setDeadlineProvider(null); await env?.teardown(); });
beforeEach(async () => {
  await env.ds.query('DELETE FROM audit_log WHERE entity_type = \'complaint\'');
  await env.ds.query('DELETE FROM complaints');
  switchState.STAFF_VIEW_COMPLAINTS = false;
  due = new Date(Date.now() + 5 * 86400000).toISOString();
  setDeadlineProvider(async () => due);
});

async function insert(officeId = OFFICE_A, over = {}) {
  const id = randomUUID();
  await env.ds.query(
    `INSERT INTO complaints (complaint_id, reference, office_id, category, description, complainant_name, complainant_email, status, created_at)
     VALUES ($1,$2,$3,'DELAYED_SERVICE','Waited too long.',$4,$5,'RECEIVED',$6)`,
    [id, `CMP-20261113-${id.slice(0, 6).toUpperCase().replace(/[01OI]/g, 'A')}`, officeId, over.name ?? 'Ana Citizen', over.email ?? 'ana@example.com', over.created ?? new Date().toISOString()],
  );
  return id;
}
const get = (token, id) => call(oneRoute, req('GET', `/complaints/${id}`, { token }), { params: { id } });
const list = (token, q = '') => call(listRoute, req('GET', `/complaints${q}`, { token }));
const ack = (token, id) => call(ackRoute, req('POST', `/complaints/${id}/acknowledge`, { token }), { params: { id } });
const resolve = (token, id, body) => call(resolveRoute, req('POST', `/complaints/${id}/resolve`, { token, body }), { params: { id } });

describe('access', () => {
  it('a list or detail without a token is 401', async () => {
    const id = await insert();
    assert.equal((await list(null)).status, 401);
    assert.equal((await get(null, id)).status, 401);
  });
  it('Office Head sees only own office; another office is a 404', async () => {
    const a = await insert(OFFICE_A); const b = await insert(OFFICE_B);
    const l = await list(tokens.officeHeadA);
    assert.deepEqual(l.body.items.map((x) => x.complaint_id), [a]);
    assert.equal((await get(tokens.officeHeadA, b)).status, 404);
    assert.equal((await ack(tokens.officeHeadA, b)).status, 404);
    assert.equal((await list(tokens.officeHeadA, `?office_id=${OFFICE_B}`)).status, 403);
  });
  it('Super Admin and Executive see every office; the Executive cannot act', async () => {
    await insert(OFFICE_A); const b = await insert(OFFICE_B);
    assert.equal((await list(tokens.superAdmin)).body.total, 2);
    assert.equal((await list(tokens.executive)).body.total, 2);
    assert.equal((await ack(tokens.executive, b)).status, 403);
    assert.equal((await resolve(tokens.executive, b, { reply: 'x' })).status, 403);
  });
  it('Office Staff: 403 while switch 3 is off; read-only when on', async () => {
    const id = await insert();
    assert.equal((await list(tokens.officeStaffA)).status, 403);
    assert.equal((await get(tokens.officeStaffA, id)).status, 403);
    switchState.STAFF_VIEW_COMPLAINTS = true;
    assert.equal((await list(tokens.officeStaffA)).status, 200);
    assert.equal((await get(tokens.officeStaffA, id)).status, 200);
    assert.equal((await ack(tokens.officeStaffA, id)).status, 403);
    assert.equal((await resolve(tokens.officeStaffA, id, { reply: 'x' })).status, 403);
  });
  it('the citizen name and email go only to Super Admin and Office Head', async () => {
    const id = await insert();
    switchState.STAFF_VIEW_COMPLAINTS = true;
    for (const t of [tokens.superAdmin, tokens.officeHeadA]) assert.equal((await get(t, id)).body.complainant_email, 'ana@example.com');
    for (const t of [tokens.executive, tokens.officeStaffA]) {
      const b = (await get(t, id)).body;
      assert.ok(!('complainant_name' in b) && !('complainant_email' in b));
      assert.ok(!JSON.stringify((await list(t)).body).includes('ana@example.com'));
    }
  });
});

describe('workflow', () => {
  it('moves forward only: received, acknowledged, resolved', async () => {
    const id = await insert();
    assert.equal((await resolve(tokens.officeHeadA, id, { reply: 'Done' })).status, 409); // not acknowledged yet
    const a = await ack(tokens.officeHeadA, id);
    assert.equal(a.status, 200); assert.equal(a.body.status, 'ACKNOWLEDGED');
    assert.equal((await ack(tokens.officeHeadA, id)).status, 409);
    const r = await resolve(tokens.officeHeadA, id, { reply: '  We fixed it.  ' });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'RESOLVED'); assert.equal(r.body.reply, 'We fixed it.');
    assert.equal((await ack(tokens.officeHeadA, id)).status, 409);
    assert.equal((await resolve(tokens.officeHeadA, id, { reply: 'again' })).status, 409);
  });
  it('resolving needs a written reply', async () => {
    const id = await insert(); await ack(tokens.officeHeadA, id);
    for (const body of [{}, { reply: '' }, { reply: '   ' }, { reply: 'x'.repeat(2001) }, { reply: 5 }]) {
      const r = await resolve(tokens.officeHeadA, id, body);
      assert.equal(r.status, 400); assert.ok('reply' in r.body.error.details);
    }
    assert.equal((await get(tokens.officeHeadA, id)).body.status, 'ACKNOWLEDGED');
  });
  it('the database refuses a resolved row without a reply', async () => {
    const id = await insert();
    await assert.rejects(env.ds.query(`UPDATE complaints SET status='RESOLVED', resolved_at=now() WHERE complaint_id=$1`, [id]));
  });
  it('audits who did what to which reference, without the citizen or the reply text', async () => {
    const id = await insert(); await ack(tokens.officeHeadA, id); await resolve(tokens.officeHeadA, id, { reply: 'Secret reply text' });
    const rows = await env.ds.query(`SELECT action, entity_name, before_value, after_value, actor_user_id FROM audit_log WHERE entity_type='complaint' ORDER BY occurred_at`);
    assert.deepEqual(rows.map((r) => r.action), ['COMPLAINT_ACKNOWLEDGED', 'COMPLAINT_RESOLVED']);
    const text = JSON.stringify(rows);
    assert.ok(!text.includes('Ana Citizen') && !text.includes('ana@example.com') && !text.includes('Secret reply text'));
    assert.match(rows[0].entity_name, /^CMP-/);
  });
  it('a bad id is a 404', async () => {
    assert.equal((await get(tokens.superAdmin, 'nope')).status, 404);
    assert.equal((await get(tokens.superAdmin, randomUUID())).status, 404);
  });
});

describe('due date and overdue', () => {
  it('fills the due time from Core when missing and flags overdue only after it', async () => {
    const id = await insert();
    const fresh = (await get(tokens.superAdmin, id)).body;
    assert.equal(fresh.due_at, due); assert.equal(fresh.overdue, false);
    await env.ds.query(`UPDATE complaints SET due_at = now() - interval '1 hour' WHERE complaint_id=$1`, [id]);
    assert.equal((await get(tokens.superAdmin, id)).body.overdue, true);
    assert.equal((await list(tokens.superAdmin, '?overdue=true')).body.total, 1);
    await ack(tokens.superAdmin, id); await resolve(tokens.superAdmin, id, { reply: 'ok' });
    assert.equal((await get(tokens.superAdmin, id)).body.overdue, false); // resolved is never overdue
    assert.equal((await list(tokens.superAdmin, '?overdue=true')).body.total, 0);
  });
  it('overdue starts after the due moment', () => {
    const row = { status: 'ACKNOWLEDGED', due_at: '2026-11-20T08:00:00.000Z' };
    assert.equal(isOverdue(row, new Date('2026-11-20T07:59:00Z')), false);
    assert.equal(isOverdue(row, new Date('2026-11-20T08:01:00Z')), true);
    assert.equal(isOverdue({ ...row, due_at: null }, new Date('2030-01-01')), false);
  });
  it('without Core the due time stays empty, never a guess', async () => {
    setDeadlineProvider(async () => null);
    const id = await insert();
    const b = (await get(tokens.superAdmin, id)).body;
    assert.equal(b.due_at, null); assert.equal(b.overdue, false);
  });
  it('asks Core for 5 working days with the service key and fails to null', async () => {
    const env2 = { CORE_URL: 'http://core', SERVICE_KEY: 'k' };
    let seen;
    const ok = async (url, init) => { seen = { url, body: JSON.parse(init.body), key: init.headers['x-service-key'] }; return { ok: true, json: async () => ({ deadline: '2026-11-20T08:00:00.000Z' }) }; };
    assert.equal(await coreDeadline({ start: '2026-11-13T01:00:00Z', officeId: OFFICE_A }, { env: env2, fetchImpl: ok }), '2026-11-20T08:00:00.000Z');
    assert.equal(seen.url, 'http://core/api/deadline'); assert.equal(seen.body.workingDays, 5); assert.equal(seen.body.heldMinutes, 0); assert.equal(seen.key, 'k');
    assert.equal(await coreDeadline({ start: '2026-11-13T01:00:00Z', officeId: OFFICE_A }, { env: env2, fetchImpl: async () => ({ ok: false }) }), null);
    assert.equal(await coreDeadline({ start: '2026-11-13T01:00:00Z', officeId: OFFICE_A }, { env: {}, fetchImpl: ok }), null);
    assert.equal(await coreDeadline({ start: '2026-11-13T01:00:00Z', officeId: OFFICE_A }, { env: env2, fetchImpl: async () => { throw new Error('down'); } }), null);
  });
  it('filters by status and rejects bad filters', async () => {
    const a = await insert(); await insert(); await ack(tokens.superAdmin, a);
    assert.equal((await list(tokens.superAdmin, '?status=ACKNOWLEDGED')).body.total, 1);
    assert.equal((await list(tokens.superAdmin, '?status=BOGUS')).status, 400);
    assert.equal((await list(tokens.superAdmin, '?page_size=500')).status, 400);
  });
});
