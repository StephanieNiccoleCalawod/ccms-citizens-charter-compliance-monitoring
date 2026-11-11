// EB6: GET /declarations (the snapshot pull route: FMS schema 3 pages for FMS keys, cal-1.0 for SMS keys).
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as declarationsRoute } from '../src/app/api/declarations/route.js';
import { DELETE as deleteRoute } from '../src/app/api/exceptions/[id]/route.js';
import { POST as postRoute } from '../src/app/api/exceptions/route.js';
import { PUT as putSchedule } from '../src/app/api/schedule/route.js';
import { issueMachineKey } from '../src/lib/machine-keys.js';
import { CHARTER_DAYS, FMS_TERM_ID, SERVICE_KEY, ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';

let env;
let machineKey;
let smsKey;
before(async () => {
  env = await setupTestEnv();
  assert.equal((await putSchedule(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: CHARTER_DAYS } }))).status, 200);
  await env.ds.query(`INSERT INTO catalogue_settings (id) VALUES (1) ON CONFLICT DO NOTHING`);
  await env.ds.query(`UPDATE catalogue_settings SET applies_to_enabled = true`);
  machineKey = (await issueMachineKey(env.ds, { id: 'sa', role: 'SUPER_ADMIN' }, { caller: 'FMS', environment: 'test' })).key;
  smsKey = (await issueMachineKey(env.ds, { id: 'sa', role: 'SUPER_ADMIN' }, { caller: 'SMS', environment: 'test' })).key;
});
after(async () => env?.teardown());
beforeEach(async () => {
  process.env.FMS_TERM_ID = FMS_TERM_ID;
  await env.ds.query('DELETE FROM sync_log');
  await env.ds.query('DELETE FROM calendar_exceptions');
});

const add = async (body) => {
  const response = await postRoute(req('POST', '/exceptions', { token: tokens.superAdmin, body }));
  return { response, body: await response.json() };
};
const remove = (id) => deleteRoute(req('DELETE', `/exceptions/${id}`, { token: tokens.superAdmin }), ctx(id));
const holiday = (date, extra = {}) => ({ exception_date: date, exception_type: 'REGULAR_HOLIDAY', description: 'Holiday', ...extra });
const pull = async (query, { key = machineKey, token } = {}) => {
  const qs = new URLSearchParams(query).toString();
  const response = await declarationsRoute(req('GET', `/declarations?${qs}`, { token: token ?? key }));
  return { response, body: await response.json() };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('EB6: GET /declarations (FMS schema 3)', () => {
  const range = { fromDate: '2026-08-17', untilDate: '2026-12-22' };

  it('returns entries and tombstones in the range as one schema 3 snapshot page', async () => {
    await add(holiday('2026-10-07'));
    const id = (await add(holiday('2026-10-08'))).body.exception.exception_id;
    await remove(id);
    await add(holiday('2027-01-01'));
    const { response, body } = await pull(range);
    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, 3);
    assert.deepEqual(body.scope, { termId: FMS_TERM_ID, fromDate: '2026-08-17', untilDate: '2026-12-22' });
    assert.equal(body.totalCount, 2);
    assert.equal(body.watermark, 4, 'revisions 1 + 2 + 1');
    assert.equal(typeof body.snapshotId, 'string');
    assert.deepEqual(body.entries.map((e) => [e.changeKind, e.declaration?.date ?? null]), [['UPSERT', '2026-10-07'], ['REMOVE', null]]);
    assert.ok(body.entries.every((e) => UUID.test(e.messageId) && e.scope.termId === FMS_TERM_ID));
    assert.equal(body.nextCursor, null);
  });

  it('a pulled entry keeps the same messageId on every pull', async () => {
    await add(holiday('2026-10-07'));
    const first = (await pull(range)).body.entries[0];
    const again = (await pull(range)).body.entries[0];
    assert.deepEqual(again, first);
  });

  it('paging returns each entry exactly once, all pages from the same cut', async () => {
    for (let d = 1; d <= 7; d += 1) await add(holiday(`2026-10-${String(d).padStart(2, '0')}`));
    const seen = [];
    const cuts = new Set();
    let cursor;
    for (let i = 0; i < 10; i += 1) {
      const { body } = await pull({ ...range, limit: '3', ...(cursor ? { cursor } : {}) });
      seen.push(...body.entries.map((x) => x.declaration.date));
      cuts.add(`${body.snapshotId}|${body.watermark}|${body.totalCount}`);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, ['01', '02', '03', '04', '05', '06', '07'].map((d) => `2026-10-${d}`));
    assert.equal(cuts.size, 1);
  });

  it('a change between pages refuses the next page; a new read starts from the new cut', async () => {
    for (let d = 1; d <= 4; d += 1) await add(holiday(`2026-10-0${d}`));
    const first = await pull({ ...range, limit: '2' });
    await add(holiday('2026-10-09'));
    const next = await pull({ ...range, limit: '2', cursor: first.body.nextCursor });
    assert.equal(next.response.status, 409);
    assert.equal(next.body.error.code, 'CALENDAR_SNAPSHOT_CHANGED');
    const fresh = await pull(range);
    assert.equal(fresh.body.totalCount, 5);
    assert.ok(fresh.body.watermark > first.body.watermark);
  });

  it('expands a recurring entry to its dates inside the range, with a series ID', async () => {
    const id = (await add(holiday('2026-09-01', { is_recurring: true }))).body.exception.exception_id;
    const { body } = await pull(range);
    assert.deepEqual(body.entries.map((e) => [e.entityId, e.declaration.seriesId]), [[`${id}@2026-09-01`, id]]);
  });

  it('refuses a range outside the FMS term, and answers 503 while FMS_TERM_ID is not set', async () => {
    assert.equal((await pull({ fromDate: '2026-08-17', untilDate: '2026-12-31' })).response.status, 400);
    delete process.env.FMS_TERM_ID;
    const { response, body } = await pull(range);
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'FMS_TERM_NOT_CONFIGURED');
  });

  it('accepts from/to as older names for fromDate/untilDate', async () => {
    await add(holiday('2026-10-07'));
    const { response, body } = await pull({ from: '2026-08-17', to: '2026-12-12' });
    assert.equal(response.status, 200);
    assert.deepEqual(body.scope, { termId: FMS_TERM_ID, fromDate: '2026-08-17', untilDate: '2026-12-12' });
  });

  it('an SMS key still gets the cal-1.0 listing', async () => {
    await add(holiday('2026-10-07'));
    const { response, body } = await pull({ from: '2026-08-17', to: '2026-12-12' }, { key: smsKey });
    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, 'cal-1.0');
    assert.equal(body.items.length, 1);
  });

  it('refuses a missing or wrong key and a user token', async () => {
    assert.equal((await pull(range, { key: null })).response.status, 401);
    assert.equal((await pull(range, { key: 'wrong' })).response.status, 401);
    assert.equal((await pull(range, { key: null, token: tokens.superAdmin })).response.status, 401);
    const shared = await declarationsRoute(req('GET', '/declarations?fromDate=2026-08-17&untilDate=2026-12-22', { key: SERVICE_KEY }));
    assert.equal(shared.status, 401);
  });

  it('refuses a bad range, limit or cursor, and a term query from an FMS key', async () => {
    assert.equal((await pull({ fromDate: '2026-12-12', untilDate: '2026-08-17' })).response.status, 400);
    assert.equal((await pull({ ...range, limit: '0' })).response.status, 400);
    assert.equal((await pull({ ...range, limit: '501' })).response.status, 400);
    assert.equal((await pull({ ...range, cursor: '!!' })).response.status, 400);
    assert.equal((await pull({ term: '2026-1S' })).response.status, 403);
  });
});
