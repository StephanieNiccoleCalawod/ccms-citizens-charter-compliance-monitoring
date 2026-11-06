// Copying the terms SMS owns into the CCMS term list (SMS_TERMS_ENABLED). SMS is a stand-in: a fetch that answers with the
// documented reply { data: [term] }.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { SYSTEM_ACTOR } from '../src/lib/calendar/holiday-import.js';
import { createException } from '../src/lib/calendar/exceptions.js';
import { importSmsTerms } from '../src/lib/calendar/sms-terms-import.js';
import { createTerm } from '../src/lib/calendar/terms.js';
import { setupTestEnv } from './calendar-helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
});
after(async () => env?.teardown());
beforeEach(async () => {
  await env.ds.query('DELETE FROM sync_log');
  await env.ds.query('DELETE FROM calendar_exceptions');
  await env.ds.query('DELETE FROM term_dates');
  await env.ds.query('DELETE FROM audit_outbox');
});

const on = { SMS_TERMS_ENABLED: 'true', SMS_URL: 'https://sms.example', SMS_SERVICE_TOKEN: 'scms-test-key' };
const smsTerm = (term_code, start_date, end_date) => ({ term_code, academic_year: '2026-2027', semester_number: 1, semester_label: 'x', display_label: `AY ${term_code}`, start_date, end_date, status: 'ACTIVE' });
const SMS = [smsTerm('2026-1S', '2026-08-17', '2026-12-12'), smsTerm('2026-2S', '2027-01-05', '2027-05-28'), smsTerm('2026-MIDYEAR', '2027-06-01', '2027-07-31')];
const reply = (list, status = 200) => async () => new Response(JSON.stringify({ statusCode: status, count: list.length, data: list }), { status });
const run = (list = SMS, opts = {}) => importSmsTerms(env.ds, { env: on, fetchImpl: reply(list), ...opts });
const stored = () => env.ds.query(`SELECT term_name, start_date::text AS s, end_date::text AS e FROM term_dates ORDER BY start_date`);
const snapshots = () => env.ds.query(`SELECT entity_id, status, payload FROM sync_log WHERE event_type = 'TERM_SNAPSHOT' AND status = 'PENDING' ORDER BY created_at`);

describe('import of the terms SMS owns', () => {
  it('does nothing while SMS_TERMS_ENABLED is not true', async () => {
    let called = false;
    const result = await importSmsTerms(env.ds, { env: {}, fetchImpl: async () => { called = true; return new Response('{}'); } });
    assert.equal(result.skipped, true);
    assert.equal(called, false);
    assert.equal((await stored()).length, 0);
  });

  it('adds the terms with the SMS term code as the name, audited like any term change', async () => {
    const result = await run();
    assert.deepEqual(result.added, ['2026-1S', '2026-2S', '2026-MIDYEAR']);
    assert.deepEqual(await stored(), [
      { term_name: '2026-1S', s: '2026-08-17', e: '2026-12-12' },
      { term_name: '2026-2S', s: '2027-01-05', e: '2027-05-28' },
      { term_name: '2026-MIDYEAR', s: '2027-06-01', e: '2027-07-31' },
    ]);
    const events = await env.ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = 'TERM_ADDED'`);
    assert.equal(events.length, 3);
    assert.equal(events[0].payload.actor_user_id, SYSTEM_ACTOR.id);
  });

  it('a calendar entry saved before its term existed is sent to SMS once the term arrives (no edit needed)', async () => {
    await createException(env.ds, SYSTEM_ACTOR, { exception_date: '2026-11-24', exception_type: 'REGULAR_HOLIDAY', description: 'Saved before the term' });
    assert.equal((await snapshots()).length, 0, 'no term covers the date, so nothing is queued for SMS');
    await run();
    const queued = await snapshots();
    assert.deepEqual(queued.map((row) => row.entity_id), ['2026-1S'], 'only the term that has an entry gets a snapshot');
    assert.deepEqual(queued[0].payload.items.map((item) => item.date), ['2026-11-24']);
  });

  it('a second run changes nothing and queues nothing new', async () => {
    await createException(env.ds, SYSTEM_ACTOR, { exception_date: '2026-11-24', exception_type: 'REGULAR_HOLIDAY', description: 'x' });
    await run();
    const before = (await env.ds.query('SELECT count(*)::int AS n FROM sync_log'))[0].n;
    const second = await run();
    assert.deepEqual([second.added, second.updated, second.unchanged], [[], [], 3]);
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM sync_log'))[0].n, before);
  });

  it('new dates from SMS update the stored term and queue a fresh snapshot of it', async () => {
    await run();
    await createException(env.ds, SYSTEM_ACTOR, { exception_date: '2026-12-14', exception_type: 'REGULAR_HOLIDAY', description: 'Just after the old end' });
    const result = await run([smsTerm('2026-1S', '2026-08-17', '2026-12-20'), SMS[1], SMS[2]]);
    assert.deepEqual(result.updated, ['2026-1S']);
    assert.equal((await stored())[0].e, '2026-12-20');
    const queued = await snapshots();
    assert.equal(queued.at(-1).entity_id, '2026-1S');
    assert.deepEqual(queued.at(-1).payload.items.map((item) => item.date), ['2026-12-14']);
  });

  it('a stored 2026-MY is the same term as SMS 2026-MIDYEAR: it is updated, not duplicated', async () => {
    await createTerm(env.ds, SYSTEM_ACTOR, { term_name: '2026-MY', start_date: '2027-06-02', end_date: '2027-07-30' }, { env: {} });
    const result = await run([SMS[2]]);
    assert.deepEqual(result.updated, ['2026-MIDYEAR']);
    assert.deepEqual(await stored(), [{ term_name: '2026-MY', s: '2027-06-01', e: '2027-07-31' }]);
  });

  it('a term that would overlap another stored term is reported and skipped, never forced', async () => {
    await createTerm(env.ds, SYSTEM_ACTOR, { term_name: 'Old hand-made term', start_date: '2026-10-01', end_date: '2026-12-30' }, { env: {} });
    const result = await run([SMS[0], SMS[1]]);
    assert.deepEqual(result.conflicts, [{ term_code: '2026-1S', reason: 'OVERLAPS_ANOTHER_STORED_TERM' }]);
    assert.deepEqual(result.added, ['2026-2S']);
    assert.deepEqual(result.not_in_sms, ['Old hand-made term']);
    assert.equal((await stored()).some((t) => t.term_name === '2026-1S'), false);
  });

  it('a stored term SMS does not list is left alone and reported', async () => {
    await createTerm(env.ds, SYSTEM_ACTOR, { term_name: '2025-2S', start_date: '2026-01-05', end_date: '2026-05-29' }, { env: {} });
    const result = await run();
    assert.deepEqual(result.not_in_sms, ['2025-2S']);
    assert.equal((await stored()).some((t) => t.term_name === '2025-2S'), true);
  });

  it('a term code that is not an SMS term code or has bad dates is reported, and the rest still imports', async () => {
    const result = await run([smsTerm('First Semester', '2026-08-17', '2026-12-12'), smsTerm('2026-1S', '2026-12-12', '2026-08-17'), SMS[1]]);
    assert.deepEqual(result.added, ['2026-2S']);
    assert.deepEqual(result.invalid.sort(), ['2026-1S', 'First Semester']);
  });

  it('a refused key or an unreachable SMS is reported with a fixed state and never throws', async () => {
    assert.equal((await importSmsTerms(env.ds, { env: on, fetchImpl: reply([], 401) })).state, 'KEY_REJECTED');
    const down = await importSmsTerms(env.ds, { env: on, fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND secret-host'); } });
    assert.equal(down.state, 'UNAVAILABLE');
    assert.equal(JSON.stringify(down).includes('secret'), false);
    assert.equal((await importSmsTerms(env.ds, { env: { SMS_TERMS_ENABLED: 'true' } })).state, 'NOT_CONFIGURED');
    assert.equal((await stored()).length, 0);
  });

  it('people still cannot add a term by hand while SMS owns them', async () => {
    await assert.rejects(createTerm(env.ds, SYSTEM_ACTOR, { term_name: '2026-1S', start_date: '2026-08-17', end_date: '2026-12-12' }, { env: on }), /Syllabus Management System/);
  });
});
