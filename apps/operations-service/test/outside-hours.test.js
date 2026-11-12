// CC051: warn and flag transactions started outside working hours.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { startTransaction } from '../src/modules/transaction/start.js';
import { isWithinWorkingTime } from '../src/modules/transaction/working-time.js';
import { NOT_IN_REGISTRY, OFFICE_A, SERVICE_A, USERS, at, resetData, seedCoreServices, setupTestEnv, staff } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  env.core.useCampusHours(true); // fixture W: Tue-Fri 08:00-19:00, Sat 08:00-17:00, Sun and Mon closed
  await resetData(env.ds);
});

const body = (over = {}) => ({ service_id: SERVICE_A, client_type: 'STUDENT', ...NOT_IN_REGISTRY, requirements_confirmed: true, ...over });
const startAt = (whenMs, over = {}) => startTransaction(env.ds, { core: createCoreClient(), now: () => new Date(whenMs) }, staff(USERS.staffA), body(over));
const count = async () => (await env.ds.query('SELECT count(*)::int AS n FROM transactions'))[0].n;
const rowOf = async (id) => (await env.ds.query('SELECT started_outside_hours, is_backdated FROM transactions WHERE transaction_id = $1', [id]))[0];
const outside = (e) => e.status === 409 && e.code === 'OUTSIDE_WORKING_TIME';

describe('CC051 outside working hours', () => {
  it('AC3: 10:00 on a working Tuesday is not flagged', async () => {
    const t = await startAt(at('2026-10-06', '10:00'));
    assert.equal(t.started_outside_hours, false);
    assert.equal((await rowOf(t.transaction_id)).started_outside_hours, false);
  });

  it('AC1: a Sunday asks for confirmation (409) and creates nothing', async () => {
    await assert.rejects(startAt(at('2026-10-11', '10:00')), outside);
    assert.equal(await count(), 0);
    const seq = await env.ds.query('SELECT count(*)::int AS n FROM tracking_sequences');
    assert.equal(seq[0].n, 0, 'no tracking number was used');
  });

  it('AC1: before opening, at closing time and after closing ask for confirmation; the opening minute does not', async () => {
    await assert.rejects(startAt(at('2026-10-06', '07:59')), outside);
    await assert.rejects(startAt(at('2026-10-06', '19:00')), outside);
    await assert.rejects(startAt(at('2026-10-06', '22:30')), outside);
    assert.equal((await startAt(at('2026-10-06', '08:00'))).started_outside_hours, false);
  });

  it('AC2: a confirmed start is saved with the flag set by the server', async () => {
    const t = await startAt(at('2026-10-11', '10:00'), { confirmOutsideHours: true });
    assert.equal(t.status, 'IN_PROGRESS');
    assert.equal(t.started_outside_hours, true);
    assert.equal((await rowOf(t.transaction_id)).started_outside_hours, true);
    const [event] = (await env.ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = 'TRANSACTION_STARTED'`)).map((r) => r.payload);
    assert.equal(event.after_value.started_outside_hours, true);
  });

  it('only an explicit true confirms (not "true", 1 or "yes")', async () => {
    for (const bad of ['true', 1, 'yes', null]) {
      await assert.rejects(startAt(at('2026-10-11', '10:00'), { confirmOutsideHours: bad }), outside);
    }
    assert.equal(await count(), 0);
  });

  it('a client cannot set the flag itself: a working-time start with a forged flag stays unflagged', async () => {
    const t = await startAt(at('2026-10-06', '10:00'), { started_outside_hours: true, confirmOutsideHours: true });
    assert.equal(t.started_outside_hours, false);
  });

  it('a holiday or a suspension counts as outside (the answer comes from Core)', async () => {
    env.core.override('GET /is-working-day', () => ({ status: 200, body: { is_working_day: false, window: null } }));
    await assert.rejects(startAt(at('2026-10-06', '10:00')), outside);
    env.core.override('GET /is-working-day', () => ({ status: 200, body: { is_working_day: true, window: { opening_time: '08:00', closing_time: '13:00' } } }));
    await assert.rejects(startAt(at('2026-10-06', '14:00')), outside);
    assert.equal((await startAt(at('2026-10-06', '12:59'))).started_outside_hours, false);
  });

  it('asks Core about the office of the service and the Manila date', async () => {
    await startAt(at('2026-10-06', '10:00'));
    const [call] = env.core.callsTo('GET', '/is-working-day');
    assert.deepEqual([call.query.date, call.query.officeId], ['2026-10-06', OFFICE_A]);
    assert.equal(call.headers['x-service-key'], 'test-service-key-0123456789');
    assert.equal(call.query.includeIntervals, 'true');
  });

  it('requires confirmation during an internal break and records the result in the analytics event', async () => {
    env.core.override('GET /is-working-day', () => ({
      status: 200,
      body: {
        is_working_day: true,
        window: { opening_time: '08:00', closing_time: '19:00' },
        working_intervals: [
          { opening_time: '08:00', closing_time: '12:00' },
          { opening_time: '13:00', closing_time: '19:00' },
        ],
      },
    }));
    await assert.rejects(startAt(at('2026-10-06', '12:30')), outside);
    assert.equal(await count(), 0);
    const t = await startAt(at('2026-10-06', '12:30'), { confirmOutsideHours: true });
    assert.equal(t.started_outside_hours, true);
    const [event] = await env.ds.query('SELECT payload FROM analytics_outbox WHERE transaction_id = $1', [t.transaction_id]);
    assert.equal(event.payload.snapshot.started_outside_hours, true);
  });

  it('AC4: a backdated entry is never flagged by this rule and Core is not asked', async () => {
    const t = await startAt(at('2026-10-11', '10:00') + 7 * 86_400_000, { started_at: '2026-10-11T10:00:00+08:00', backdate_reason: 'Entered late' });
    assert.equal(t.is_backdated, true);
    assert.equal(t.started_outside_hours, false);
    assert.equal(env.core.callsTo('GET', '/is-working-day').length, 0);
  });

  it('Core unreachable: 503, nothing saved (the one-retry rule is unchanged)', async () => {
    env.core.override('GET /is-working-day', () => ({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } }));
    await assert.rejects(startAt(at('2026-10-06', '10:00')), (e) => e.status === 503 && e.code === 'CALENDAR_UNAVAILABLE');
    assert.equal(env.core.callsTo('GET', '/is-working-day').length, 2, 'one retry');
    assert.equal(await count(), 0);
  });

  it('a garbled Core answer counts as Core being unavailable', async () => {
    env.core.override('GET /is-working-day', () => ({ status: 200, body: { is_working_day: true } }));
    await assert.rejects(startAt(at('2026-10-06', '10:00')), (e) => e.status === 503);
  });

  it('isWithinWorkingTime: opening counts, closing does not', async () => {
    const core = createCoreClient();
    assert.equal(await isWithinWorkingTime(core, { officeId: OFFICE_A, at: new Date(at('2026-10-06', '08:00')) }), true);
    assert.equal(await isWithinWorkingTime(core, { officeId: OFFICE_A, at: new Date(at('2026-10-06', '18:59')) }), true);
    assert.equal(await isWithinWorkingTime(core, { officeId: OFFICE_A, at: new Date(at('2026-10-06', '19:00')) }), false);
    assert.equal(await isWithinWorkingTime(core, { officeId: OFFICE_A, at: new Date(at('2026-10-12', '10:00')) }), false);
  });

  it('a Start of another office is refused (403) before anything is said about working time', async () => {
    await assert.rejects(
      startTransaction(env.ds, { core: createCoreClient(), now: () => new Date(at('2026-10-11', '10:00')) }, staff(USERS.staffB, '00000000-0000-4000-8000-000000000000'), body()),
      (e) => e.status === 403,
    );
  });
});
