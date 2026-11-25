import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GRANTABLE_KEYS, ROLES, createGrantGate, resolveEndsOn } from 'ccms-shared';
import { MSG, parseDecision, parseRequest } from '../src/lib/access-requests.js';

const head = { id: '11111111-1111-4111-8111-111111111111', role: ROLES.OFFICE_HEAD, officeId: '22222222-2222-4222-8222-222222222222' };
const admin = { id: '33333333-3333-4333-8333-333333333333', role: ROLES.SUPER_ADMIN };
const TODAY = '2026-11-25';

describe('S8-52 which permissions can be requested (D-AC-4)', () => {
  it('only the four agreed ones, and nothing else', () => {
    assert.deepEqual([...GRANTABLE_KEYS].sort(), ['EXPORT_CSV', 'RECORD_PAST_TRANSACTIONS', 'REPORTS_PER_PERSON', 'VIEW_OFFICE_QUEUE']);
    for (const bad of ['MANAGE_ACCOUNTS', 'CHANGE_SETTINGS', 'super_admin', '', undefined]) {
      assert.throws(() => parseRequest({ permission_key: bad, reason: 'x' }, head), (e) => e.status === 400);
    }
  });
  it('needs a reason, and only an Office Head or Office Staff may ask', () => {
    assert.throws(() => parseRequest({ permission_key: 'EXPORT_CSV', reason: '  ' }, head), (e) => e.details.reason === MSG.REASON);
    assert.throws(() => parseRequest({ permission_key: 'EXPORT_CSV', reason: 'ok' }, admin), (e) => e.status === 403);
    assert.throws(() => parseRequest({ permission_key: 'EXPORT_CSV', reason: 'ok' }, { ...head, role: ROLES.EXECUTIVE }), (e) => e.status === 403);
    assert.deepEqual(parseRequest({ permission_key: 'EXPORT_CSV', reason: ' for the audit ' }, head), { key: 'EXPORT_CSV', reason: 'for the audit' });
  });
});

describe('S8-52 end date: 30 days by default, 90 at most, never empty', () => {
  it('defaults to 30 days from today', () => assert.equal(resolveEndsOn(undefined, TODAY), '2026-12-25'));
  it('accepts a date up to 90 days away', () => { assert.equal(resolveEndsOn('2027-02-23', TODAY), '2027-02-23'); });
  it('refuses empty, past, today, invalid and longer than 90 days', () => {
    for (const bad of [null, '', '2026-11-25', '2026-11-01', '2026-13-40', '2027-02-24', 5]) assert.throws(() => resolveEndsOn(bad, TODAY), (e) => e.status === 400 && Boolean(e.details.ends_on), String(bad));
    assert.throws(() => resolveEndsOn('2027-02-24', TODAY), /at most 90 days/);
  });
});

describe('S8-52 deciding', () => {
  it('nobody decides their own request, and only the Super Admin decides', () => {
    assert.throws(() => parseDecision({ decision: 'GRANT' }, { requesterId: admin.id, actor: admin, today: TODAY }), (e) => e.status === 403 && e.code === 'SELF_DECISION');
    assert.throws(() => parseDecision({ decision: 'GRANT' }, { requesterId: head.id, actor: head, today: TODAY }), (e) => e.status === 403);
  });
  it('a grant gets an end date (30 days if none is sent); a denial has none', () => {
    assert.equal(parseDecision({ decision: 'GRANT' }, { requesterId: head.id, actor: admin, today: TODAY }).endsOn, '2026-12-25');
    assert.equal(parseDecision({ decision: 'GRANT', ends_on: '2026-12-01' }, { requesterId: head.id, actor: admin, today: TODAY }).endsOn, '2026-12-01');
    assert.equal(parseDecision({ decision: 'DENY', note: 'Not needed' }, { requesterId: head.id, actor: admin, today: TODAY }).endsOn, null);
    assert.throws(() => parseDecision({ decision: 'MAYBE' }, { requesterId: head.id, actor: admin, today: TODAY }), (e) => e.status === 400);
    assert.throws(() => parseDecision({ decision: 'GRANT', ends_on: '' }, { requesterId: head.id, actor: admin, today: TODAY }), (e) => Boolean(e.details.ends_on));
  });
});

describe('S8-52 the check in the other services', () => {
  const env = { IDENTITY_URL: 'http://identity', SERVICE_KEY: 'k' };
  const user = { id: head.id, role: ROLES.OFFICE_STAFF, officeId: head.officeId };
  const answer = (grants, ok = true) => async () => ({ ok, json: async () => ({ grants }) });
  it('a grant in the person’s own office counts', async () => {
    const gate = createGrantGate({ env, fetchImpl: answer([{ permission_key: 'EXPORT_CSV', office_id: head.officeId }]) });
    assert.equal(await gate.has(user, 'EXPORT_CSV'), true);
    assert.equal(await gate.has(user, 'REPORTS_PER_PERSON'), false);
  });
  it('a grant of another office, an unknown key, an error or no Identity all mean no access', async () => {
    assert.equal(await createGrantGate({ env, fetchImpl: answer([{ permission_key: 'EXPORT_CSV', office_id: '99999999-9999-4999-8999-999999999999' }]) }).has(user, 'EXPORT_CSV'), false);
    assert.equal(await createGrantGate({ env, fetchImpl: answer([{ permission_key: 'MANAGE_ACCOUNTS', office_id: head.officeId }]) }).has(user, 'MANAGE_ACCOUNTS'), false);
    assert.equal(await createGrantGate({ env, fetchImpl: answer([], false) }).has(user, 'EXPORT_CSV'), false);
    assert.equal(await createGrantGate({ env: {}, fetchImpl: async () => { throw new Error('no call'); } }).has(user, 'EXPORT_CSV'), false);
    assert.equal(await createGrantGate({ env, fetchImpl: async () => { throw new Error('down'); } }).has(user, 'EXPORT_CSV'), false);
  });
  it('remembers an answer for 10 seconds, so a revoke applies on the next request after that', async () => {
    let calls = 0; let t = 0;
    const gate = createGrantGate({ env, now: () => t, fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ grants: calls === 1 ? [{ permission_key: 'EXPORT_CSV', office_id: head.officeId }] : [] }) }; } });
    assert.equal(await gate.has(user, 'EXPORT_CSV'), true);
    t = 5000; assert.equal(await gate.has(user, 'EXPORT_CSV'), true);
    t = 11000; assert.equal(await gate.has(user, 'EXPORT_CSV'), false);
  });
});
