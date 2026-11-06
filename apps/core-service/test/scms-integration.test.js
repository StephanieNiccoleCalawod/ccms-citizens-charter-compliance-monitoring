// Core <-> SMS (SCMS): the body SMS ingests, its replies, a refused key, the pull by term, and the terms reader.
// The SCMS side is a stand-in that answers the way the SCMS code supplied does (calendar.controller.ts, term.controller.ts).
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as postException } from '../src/app/api/exceptions/route.js';
import { DELETE as deleteException } from '../src/app/api/exceptions/[id]/route.js';
import { GET as declarationsRoute } from '../src/app/api/declarations/route.js';
import { POST as issueRoute } from '../src/app/api/machine-keys/route.js';
import { dispatchSyncLogs } from '../src/lib/calendar/sync-dispatch.js';
import { SMS_TYPE_MAP, smsTermCode, toSmsWire } from '../src/lib/calendar/sms-snapshot.js';
import { smsPushUrl, syncSettings } from '../src/jobs/calendar-sync.js';
import { fetchSmsTerms } from '../src/lib/calendar/sms-terms-client.js';
import { getSyncStatus } from '../src/lib/calendar/sync.js';
import { ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  await env.ds.query('INSERT INTO catalogue_settings (id) VALUES (1) ON CONFLICT DO NOTHING');
  await env.ds.query('UPDATE catalogue_settings SET applies_to_enabled = true');
});
after(async () => env?.teardown());
beforeEach(async () => {
  await env.ds.query('DELETE FROM sync_log');
  await env.ds.query('DELETE FROM calendar_exceptions');
  await env.ds.query('DELETE FROM term_dates');
  await env.ds.query('DELETE FROM machine_keys');
  await env.ds.query(`INSERT INTO term_dates (term_id, term_name, start_date, end_date) VALUES (gen_random_uuid(), '2026-1S', '2026-08-17', '2026-12-12')`);
});

const save = async (body) => {
  const response = await postException(req('POST', '/exceptions', { token: tokens.superAdmin, body }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return response.json();
};
const rows = () => env.ds.query(`SELECT sync_id, status, attempts, last_error, reply FROM sync_log WHERE entity_type = 'term_snapshot' AND status <> 'SUPERSEDED' ORDER BY created_at`);
const scms = (reply, status = 200) => {
  const calls = [];
  return {
    calls,
    run: (extra = {}) => dispatchSyncLogs(env.ds, {
      urls: { AUDIT: 'http://scms.test/api/v1/calendar/sync' }, receiverTokens: { AUDIT: 'scms-test-key' },
      retryIntervalMs: 0, maxAttempts: 3, enabledConsumers: ['AUDIT'], onlySmsEntityTypes: ['term_snapshot'], ...extra,
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
      },
    }),
  };
};
const ACCEPTED = { statusCode: 200, result: 'ACCEPTED', status: 'PROCESSED', term_code: '2026-1S', counts: { added: 1, updated: 0, removed: 0 } };

describe('push to SMS (SCMS ingest body)', () => {
  it('sends the body SCMS reads: sync_id, term_code, snapshot, entries; Bearer key; no academic_term', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'SPECIAL_NON_WORKING', description: 'Special day' });
    await save({ exception_date: '2026-10-05', exception_type: 'SUSPENSION', description: 'Part day', suspended_from: '13:00', suspended_until: '17:00', applies_to: 'CLASSES', class_mode: 'ONLINE' });
    const sms = scms(ACCEPTED);
    await sms.run();
    assert.equal(sms.calls.length, 1);
    const { body, headers } = sms.calls[0];
    assert.equal(headers.authorization, 'Bearer scms-test-key');
    assert.equal(body.snapshot, true);
    assert.equal(body.term_code, '2026-1S');
    assert.ok(body.sync_id);
    assert.equal('academic_term' in body, false, 'SMS owns the terms: we must not overwrite its term row');
    assert.deepEqual(body.entries.map((e) => e.date), ['2026-09-21', '2026-10-05']);
    assert.equal(body.entries[0].entry_type, 'SPECIAL_NON_WORKING');
    assert.equal(SMS_TYPE_MAP.SPECIAL_NON_WORKING, 'SPECIAL_NON_WORKING');
    assert.equal(body.entries[0].name, 'Special day');
    assert.ok(body.entries[0].entity_id);
    assert.equal(body.entries[1].effect, 'ONLINE');
    assert.deepEqual(body.entries[1].appliesTo, ['CLASSES']);
    assert.deepEqual(body.entries[1].interval, { start: '2026-10-05T13:00:00+08:00', end: '2026-10-05T17:00:00+08:00' });
  });

  it('a withdrawn entry is simply absent from the next snapshot (SMS withdraws what is not listed); REMOVE is never sent', async () => {
    const a = await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    await save({ exception_date: '2026-09-22', exception_type: 'REGULAR_HOLIDAY', description: 'B' });
    const id = a.exception?.exception_id ?? a.exception_id ?? a.id;
    const gone = await deleteException(req('DELETE', `/exceptions/${id}`, { token: tokens.superAdmin }), ctx(id));
    assert.equal(gone.status, 204);
    const sms = scms(ACCEPTED);
    await sms.run();
    assert.equal(sms.calls.length, 1);
    assert.deepEqual(sms.calls[0].body.entries.map((e) => e.name), ['B']);
    assert.equal(JSON.stringify(sms.calls[0].body).includes('REMOVE'), false);
  });

  it('reply ACCEPTED is stored; a retried or repeated sync_id (ALREADY_PROCESSED) is also fine', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    await scms({ ...ACCEPTED, status: 'ALREADY_PROCESSED' }).run();
    const [row] = await rows();
    assert.equal(row.status, 'SENT');
    assert.equal(row.reply.result, 'ACCEPTED');
  });

  it('reply REJECTED (200 or 422) keeps the row FAILED with SMS\'s reason, and it is retried', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    await scms({ result: 'REJECTED', reason: 'bad entry' }).run();
    let [row] = await rows();
    assert.equal(row.status, 'FAILED');
    assert.match(row.last_error, /bad entry/);
    await scms({ statusCode: 422, result: 'REJECTED', reason: 'sync ID and term code are mandatory.' }, 422).run();
    [row] = await rows();
    assert.equal(row.status, 'FAILED');
    assert.equal(row.attempts, 2);
    assert.match(row.last_error, /422: sync ID and term code are mandatory/);
    await scms(ACCEPTED).run();
    [row] = await rows();
    assert.equal(row.status, 'SENT');
  });

  it('a refused key (401) stops retrying and says so; it is not retried in a loop', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    const sms = scms('', 401);
    await sms.run();
    await sms.run();
    await sms.run();
    assert.equal(sms.calls.length, 1);
    const [row] = await rows();
    assert.equal(row.status, 'FAILED');
    assert.equal(row.attempts, 3);
    assert.match(row.last_error, /^KEY_REJECTED/);
    assert.equal(JSON.stringify(row).includes('scms-test-key'), false);
  });

  it('a term whose name is not an SMS term code is not sent: the row fails with a clear reason', async () => {
    await env.ds.query(`UPDATE term_dates SET term_name = 'First Semester AY 26-27'`);
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    const sms = scms(ACCEPTED);
    await sms.run();
    assert.equal(sms.calls.length, 0);
    const [row] = await rows();
    assert.equal(row.status, 'FAILED');
    assert.match(row.last_error, /not an SMS term code/);
  });

  it('term codes: 2026-1S stays, 2026-MY is sent as 2026-MIDYEAR, anything else is refused', () => {
    assert.equal(smsTermCode('2026-1S'), '2026-1S');
    assert.equal(smsTermCode('2026-my'), '2026-MIDYEAR');
    assert.equal(smsTermCode('2026-MIDYEAR'), '2026-MIDYEAR');
    assert.equal(smsTermCode('A.Y. 2026-2027'), null);
    assert.throws(() => toSmsWire({ termCode: 'nope', items: [] }), /not an SMS term code/);
  });
});

describe('settings for SMS', () => {
  it('a bare SMS address gets /api/v1/calendar/sync; an address with a path is used as given', () => {
    assert.equal(smsPushUrl('https://staging-scms.pupqc.edu.ph'), 'https://staging-scms.pupqc.edu.ph/api/v1/calendar/sync');
    assert.equal(smsPushUrl('http://localhost:3000/'), 'http://localhost:3000/api/v1/calendar/sync');
    assert.equal(smsPushUrl('http://127.0.0.1:4102/calendar'), 'http://127.0.0.1:4102/calendar');
  });

  it('SMS_SERVICE_TOKEN is used, SMS_CALENDAR_TOKEN still works; SMS stays off without SMS_SYNC_ENABLED', () => {
    const base = { SMS_URL: 'http://localhost:3000', FMS_URL: 'http://f.test', FMS_CALENDAR_TOKEN: 'f' };
    assert.equal(syncSettings({ ...base, SMS_SERVICE_TOKEN: 'a', SMS_CALENDAR_TOKEN: 'b', SMS_SYNC_ENABLED: 'true' }).receiverTokens.AUDIT, 'a');
    assert.equal(syncSettings({ ...base, SMS_CALENDAR_TOKEN: 'b', SMS_SYNC_ENABLED: 'true' }).receiverTokens.AUDIT, 'b');
    assert.deepEqual(syncSettings({ ...base, SMS_SERVICE_TOKEN: 'a' }).enabledConsumers, ['FMS']);
    assert.deepEqual(syncSettings({ ...base, SMS_SERVICE_TOKEN: 'a', SMS_SYNC_ENABLED: 'true' }).enabledConsumers, ['FMS', 'AUDIT']);
  });
});

describe('SMS pulls the calendar by term', () => {
  const key = async (caller) => {
    const response = await issueRoute(req('POST', '/machine-keys', { token: tokens.superAdmin, body: { caller, environment: 'test' } }));
    return (await response.json()).key;
  };
  const pull = (path, token) => declarationsRoute(req('GET', path, { token }));

  it('an SMS key reads one term; the 2026-MY alias works for a midyear term; an unknown term is 404', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'In term' });
    await save({ exception_date: '2026-12-25', exception_type: 'REGULAR_HOLIDAY', description: 'After term' });
    await env.ds.query(`INSERT INTO term_dates (term_id, term_name, start_date, end_date) VALUES (gen_random_uuid(), '2027-MIDYEAR', '2027-06-01', '2027-07-31')`);
    const sms = await key('SMS');
    const response = await pull('/declarations?term=2026-1S', sms);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((i) => i.description), ['In term']);
    assert.equal(body.from, '2026-08-17');
    assert.equal((await pull('/declarations?term=2027-MY', sms)).status, 200);
    const unknown = await pull('/declarations?term=2030-1S', sms);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'TERM_NOT_FOUND');
    assert.equal((await pull('/declarations?term=banana', sms)).status, 400);
    assert.equal((await pull('/declarations?term=2026-1S&from=2026-08-17&to=2026-09-01', sms)).status, 400);
  });

  it('an FMS key cannot use ?term= (403) but still reads by date range; no key is 401', async () => {
    const fms = await key('FMS');
    assert.equal((await pull('/declarations?term=2026-1S', fms)).status, 403);
    assert.equal((await pull('/declarations?from=2026-08-17&to=2026-12-12', fms)).status, 200);
    assert.equal((await pull('/declarations?term=2026-1S', undefined)).status, 401);
  });
});

describe('terms reader (SMS_TERMS_ENABLED)', () => {
  const smsTerms = { statusCode: 200, count: 2, data: [
    { term_code: '2026-1S', academic_year: '2026-2027', semester_number: 1, semester_label: '1ST_SEMESTER', display_label: 'A.Y. 2026-2027 First Semester', start_date: '2026-08-17', end_date: '2026-12-12', status: 'ACTIVE' },
    { term_code: '2026-MY', academic_year: '2026-2027', semester_number: 3, semester_label: 'MIDYEAR', display_label: 'A.Y. 2026-2027 Midyear Term', start_date: '2027-06-01T00:00:00.000Z', end_date: '2027-07-31', status: 'UPCOMING' },
  ] };
  const env0 = { SMS_URL: 'https://staging-scms.pupqc.edu.ph/some/path', SMS_SERVICE_TOKEN: 'scms-test-key', SMS_TERMS_ENABLED: 'true' };

  it('is off by default and when the address or key is missing', async () => {
    assert.equal((await fetchSmsTerms({ env: { ...env0, SMS_TERMS_ENABLED: '' }, fetchImpl: async () => assert.fail('must not call') })).skipped, true);
    assert.equal((await fetchSmsTerms({ env: { SMS_TERMS_ENABLED: 'true' }, fetchImpl: async () => assert.fail('must not call') })).skipped, true);
  });

  it('calls GET {origin}/api/v1/terms with the Bearer key and normalises the terms (alias MY becomes MIDYEAR)', async () => {
    let seen;
    const result = await fetchSmsTerms({ env: env0, fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(smsTerms)); } });
    assert.equal(seen.url, 'https://staging-scms.pupqc.edu.ph/api/v1/terms');
    assert.equal(seen.init.headers.authorization, 'Bearer scms-test-key');
    assert.deepEqual(result.terms.map((t) => [t.termCode, t.startDate, t.endDate, t.semesterNumber]), [['2026-1S', '2026-08-17', '2026-12-12', 1], ['2026-MIDYEAR', '2027-06-01', '2027-07-31', 3]]);
  });

  it('a 401 is reported as KEY_REJECTED, another failure as an error', async () => {
    await assert.rejects(fetchSmsTerms({ env: env0, fetchImpl: async () => new Response('', { status: 401 }) }), { code: 'KEY_REJECTED' });
    await assert.rejects(fetchSmsTerms({ env: env0, fetchImpl: async () => new Response('', { status: 500 }) }), /500/);
  });
});

describe('sync status for the Calendar page (SMS)', () => {
  it('a successful push shows when SMS last received data; nothing is flagged', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    assert.equal((await getSyncStatus(env.ds)).sms_last_received, null);
    await scms(ACCEPTED).run();
    const status = await getSyncStatus(env.ds);
    assert.ok(status.sms_last_received);
    assert.equal(status.sms_issue, null);
  });

  it('a refused key (401) shows KEY_REJECTED, with no error text or key in the answer', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    await scms('', 401).run();
    const status = await getSyncStatus(env.ds);
    assert.equal(status.sms_issue.state, 'KEY_REJECTED');
    assert.deepEqual(Object.keys(status.sms_issue).sort(), ['at', 'state']);
    assert.equal(JSON.stringify(status).includes('scms-test-key'), false);
    assert.equal(status.sms_last_received, null);
  });

  it('another failure shows FAILED, and a later success clears it', async () => {
    await save({ exception_date: '2026-09-21', exception_type: 'REGULAR_HOLIDAY', description: 'A' });
    await scms({ result: 'REJECTED', reason: 'bad entry' }).run();
    assert.equal((await getSyncStatus(env.ds)).sms_issue.state, 'FAILED');
    await scms(ACCEPTED).run();
    const status = await getSyncStatus(env.ds);
    assert.equal(status.sms_issue, null);
    assert.ok(status.sms_last_received);
  });
});
