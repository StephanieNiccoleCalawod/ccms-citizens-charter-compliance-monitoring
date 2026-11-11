import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as requeue } from '../src/app/api/sync/[id]/requeue/route.js';
import { GET as status } from '../src/app/api/sync/status/route.js';
import { dispatchSyncLogs } from '../src/lib/calendar/sync-dispatch.js';
import { createMockServer } from '../mocks/mock-server.js';
import { setupTestEnv, tokens, req, ctx } from './calendar-helpers.js';

let env;
let receiver;
let url;
const key = 'qa-fms-receiver-key';
before(async () => {
  env = await setupTestEnv();
  receiver = createMockServer({ name: 'FMS', calendarToken: key });
  url = `http://127.0.0.1:${await receiver.listen(0)}/calendar`;
});
after(async () => { await receiver?.close(); await env?.teardown(); });
beforeEach(async () => {
  await env.ds.query('DELETE FROM sync_log');
  receiver.state.rejected = 0;
  receiver.state.received = [];
  receiver.state.fail = false;
});
const row = async (id) => (await env.ds.query('SELECT * FROM sync_log WHERE sync_id = $1', [id]))[0];
async function queue(consumer = 'FMS') {
  const id = randomUUID();
  // Make the fixture due even when JavaScript and PostgreSQL resolve the current time at different precision.
  await env.ds.query(
    `INSERT INTO sync_log (sync_id, consumer_system, event_type, entity_type, payload, next_attempt_at)
     VALUES ($1, $2, 'CALENDAR_EXCEPTION_ADDED', 'calendar_exception', $3::jsonb, '2000-01-01T00:00:00Z')`,
    [id, consumer, JSON.stringify({ messageId: id, date: '2026-12-25' })],
  );
  return id;
}
const dispatch = (token = key, consumer = 'FMS') => dispatchSyncLogs(env.ds, {
  urls: { [consumer]: url }, receiverTokens: { [consumer]: token }, enabledConsumers: [consumer], retryIntervalMs: 0, maxAttempts: 5,
});
const retry = (id, token = tokens.superAdmin) => requeue(req('POST', `/sync/${id}/requeue`, { token }), ctx(id));

describe('TT6 FMS rejected-key recovery on a disposable local database', () => {
  it('makes one request for a 401, exposes KEY_REJECTED and never retries automatically', async () => {
    const id = await queue();
    assert.deepEqual(await dispatch('wrong-key'), { sent: 0, failed: 1 });
    assert.equal(receiver.state.rejected, 1);
    assert.match((await row(id)).last_error, /^KEY_REJECTED:/);
    assert.doesNotMatch((await row(id)).last_error, /wrong-key|qa-fms-receiver-key/);
    for (let i = 0; i < 3; i += 1) assert.deepEqual(await dispatch(), { sent: 0, failed: 0 });
    assert.equal(receiver.state.rejected, 1);
    assert.equal(receiver.state.received.length, 0);
    const body = await (await status(req('GET', '/sync/status', { token: tokens.superAdmin }))).json();
    assert.equal(body.fms_last_push.error_code, 'KEY_REJECTED');
    assert.equal(body.recent.find((item) => item.sync_id === id).error_code, 'KEY_REJECTED');
  });
  it('requeues the same payload after the key is fixed and records an audit event', async () => {
    const id = await queue();
    await dispatch('wrong-key');
    const beforeRow = await row(id);
    assert.equal((await retry(id)).status, 200);
    const pending = await row(id);
    assert.equal(pending.status, 'PENDING');
    assert.equal(pending.attempts, 0);
    assert.equal(pending.last_error, null);
    assert.deepEqual(pending.payload, beforeRow.payload);
    assert.deepEqual(await dispatch(), { sent: 1, failed: 0 });
    assert.equal((await row(id)).status, 'SENT');
    assert.equal(receiver.state.received[0].body.messageId, id);
    const audits = await env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' = 'SYNC_REQUEUED' AND payload->>'entity_id' = $1", [id]);
    assert.equal(audits.length, 1);
    assert.doesNotMatch(JSON.stringify(audits), /wrong-key|qa-fms-receiver-key/);
  });
  it('refuses unauthenticated and non-admin requeue requests', async () => {
    const id = await queue();
    await dispatch('wrong-key');
    assert.equal((await retry(id, null)).status, 401);
    for (const token of [tokens.officeHeadA, tokens.officeStaffA, tokens.executive]) assert.equal((await retry(id, token)).status, 403);
    assert.equal((await row(id)).status, 'FAILED');
    assert.equal(receiver.state.rejected, 1);
  });
  it('rejects unrelated and already-requeued rows', async () => {
    const id = await queue();
    assert.equal((await retry(id)).status, 409);
    assert.equal((await retry(randomUUID())).status, 404);
    await dispatch('wrong-key');
    assert.equal((await retry(id)).status, 200);
    assert.equal((await retry(id)).status, 409);
  });
  it('retains bounded retries for non-401 failures', async () => {
    const id = await queue();
    receiver.state.fail = true;
    for (let i = 0; i < 5; i += 1) assert.deepEqual(await dispatch(), { sent: 0, failed: 1 });
    assert.equal((await row(id)).attempts, 5);
    assert.equal(receiver.state.rejected, 5);
    assert.deepEqual(await dispatch(), { sent: 0, failed: 0 });
  });
  it('preserves the existing SCMS/SMS terminal 401 rule', async () => {
    const id = await queue('AUDIT');
    assert.deepEqual(await dispatch('wrong-key', 'AUDIT'), { sent: 0, failed: 1 });
    assert.match((await row(id)).last_error, /^KEY_REJECTED:/);
    assert.deepEqual(await dispatch(key, 'AUDIT'), { sent: 0, failed: 0 });
    assert.equal(receiver.state.rejected, 1);
  });
});
