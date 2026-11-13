// Sprint 7 CC055: the Operations half of the notification bell.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { GET as listRoute } from '../src/app/api/notifications/route.js';
import { listOperationsNotifications, notificationsFromRisk } from '../src/modules/notifications/notifications.js';
import { OFFICE_A, OFFICE_B, USERS, admin, call, head, req, setupTestEnv, staff, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => env?.teardown());

const item = (over = {}) => ({ transaction_id: randomUUID(), tracking_no: 'TRK-1', service_name: 'TOR Request', level: 'LOW', working_minutes_left: 100, share_used: 0.3, can_open: true, ...over });

describe('which notices are made', () => {
  it('overdue when nothing is left, deadline from 80%, high risk when High, and nothing for a calm one', () => {
    const out = notificationsFromRisk([item({ working_minutes_left: 0, share_used: 1 }), item({ share_used: 0.8 }), item({ share_used: 0.79 }), item({ level: 'HIGH', share_used: 0.5 }), item()]);
    assert.deepEqual(out.map((n) => n.kind), ['OVERDUE', 'DEADLINE', 'HIGH_RISK']);
  });
  it('an overdue transaction is one notice even if High; a transaction can be near its limit and High', () => {
    assert.equal(notificationsFromRisk([item({ working_minutes_left: 0, level: 'HIGH' })]).length, 1);
    assert.deepEqual(notificationsFromRisk([item({ share_used: 0.9, level: 'HIGH' })]).map((n) => n.kind), ['DEADLINE', 'HIGH_RISK']);
  });
  it('skips transactions the person may not open, and old scores without a share', () => {
    assert.equal(notificationsFromRisk([item({ can_open: false, working_minutes_left: 0 })]).length, 0);
    assert.equal(notificationsFromRisk([item({ share_used: undefined })]).length, 0);
  });
  it('keys are stable per transaction and kind', () => {
    const i = item({ share_used: 0.9 });
    assert.equal(notificationsFromRisk([i])[0].key, `deadline:${i.transaction_id}`);
  });
});

describe('who gets what', () => {
  const risk = async () => ({ items: [item({ working_minutes_left: 0 })] });
  it('an Office Head or Staff member is served for their own office', async () => {
    let asked;
    const out = await listOperationsNotifications(null, head(USERS.headA), { readRisk: async (_db, office) => { asked = office; return risk(); } });
    assert.equal(asked, OFFICE_A.toLowerCase());
    assert.equal(out.items.length, 1);
    assert.equal((await listOperationsNotifications(null, staff(USERS.staffA), { readRisk: risk })).items.length, 1);
  });
  it('another office is refused; the Super Admin needs an office; the Executive has no bell', async () => {
    await assert.rejects(listOperationsNotifications(null, head(USERS.headA), { officeId: OFFICE_B, readRisk: risk }), { status: 403 });
    assert.deepEqual((await listOperationsNotifications(null, admin(), { readRisk: risk })).items, []);
    assert.equal((await listOperationsNotifications(null, admin(), { officeId: OFFICE_B, readRisk: risk })).items.length, 1);
    await assert.rejects(listOperationsNotifications(null, { id: randomUUID(), role: 'executive' }, { readRisk: risk }), { status: 403 });
    await assert.rejects(listOperationsNotifications(null, admin(), { officeId: 'nope', readRisk: risk }), { status: 400 });
  });
});

describe('route', () => {
  it('401 without a token, 403 for the Executive, 200 for the Super Admin with nothing to show', async () => {
    assert.equal((await call(listRoute, req('GET', '/notifications'))).status, 401);
    assert.equal((await call(listRoute, req('GET', '/notifications', { token: tokens.executive }))).status, 403);
    const res = await call(listRoute, req('GET', '/notifications', { token: tokens.superAdmin }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
  });
});
