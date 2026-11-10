// CC048: per-office working days and hours, with a lunch break: the table, who may read and change it, validation, versions,
// the audit trail, and proof that nothing about it reaches FMS or SCMS. (The engine results are in
// office-schedule-engine-api.test.js, which scripts/test-engine-tz.mjs also runs under other server time zones.)
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestDatabase } from 'ccms-shared/testing';
import { GET as declarationsRoute } from '../src/app/api/declarations/route.js';
import { DELETE as resetRoute, GET as getRoute, PUT as putRoute } from '../src/app/api/offices/[id]/schedule/route.js';
import { PUT as putCampus } from '../src/app/api/schedule/route.js';
import { issueMachineKey } from '../src/lib/machine-keys.js';
import { migrateSprint5Core } from '../src/lib/migrations/sprint5.js';
import { CHARTER_DAYS, DEFAULT_DAYS, OFFICE_A, OFFICE_B, ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';

let env;
let machineKey;
before(async () => {
  env = await setupTestEnv();
  for (const [id, code, name] of [[OFFICE_A, 'OFA', 'Office A'], [OFFICE_B, 'OFB', 'Office B']]) {
    await env.ds.query('INSERT INTO offices (office_id, office_code, office_name) VALUES ($1, $2, $3)', [id, code, name]);
  }
  await env.ds.query('INSERT INTO catalogue_settings (id) VALUES (1) ON CONFLICT DO NOTHING');
  machineKey = (await issueMachineKey(env.ds, { id: 'sa', role: 'SUPER_ADMIN' }, { caller: 'FMS', environment: 'test' })).key;
});
after(async () => env?.teardown());
beforeEach(async () => {
  await env.ds.query('DELETE FROM office_schedules');
  await env.ds.query('DELETE FROM office_schedule_versions');
  await env.ds.query('DELETE FROM sync_log');
  await env.ds.query(`DELETE FROM audit_outbox WHERE payload->>'action' IN ('OFFICE_SCHEDULE_UPDATED', 'WORKING_HOURS_UPDATED')`);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const row = (dow, working, open = null, close = null, lunch = null) => ({
  day_of_week: dow,
  is_working: working,
  opening_time: working ? open : null,
  closing_time: working ? close : null,
  closes_for_lunch: Boolean(lunch),
  lunch_start: lunch ? lunch[0] : null,
  lunch_end: lunch ? lunch[1] : null,
});
// Mon-Fri 08:00-17:00 with lunch 12:00-13:00, Saturday 08:00-12:00, Sunday off.
const WEEK = [row(0, false), ...[1, 2, 3, 4, 5].map((d) => row(d, true, '08:00', '17:00', ['12:00', '13:00'])), row(6, true, '08:00', '12:00')];
const without = (days, dow, patch) => days.map((d) => (d.day_of_week === dow ? { ...d, ...patch } : d));

const call = async (handler, method, officeId, { token = tokens.superAdmin, body, query = '' } = {}) => {
  const response = await handler(req(method, `/offices/${officeId}/schedule${query}`, { token, body }), ctx(officeId));
  return { status: response.status, body: await response.json() };
};
const get = (officeId = OFFICE_A, token) => call(getRoute, 'GET', officeId, { token });
const put = (days, version, officeId = OFFICE_A, token) => call(putRoute, 'PUT', officeId, { token, body: { version, days } });
const reset = (version, officeId = OFFICE_A, token) => call(resetRoute, 'DELETE', officeId, { token, query: `?version=${version}` });
const rows = (officeId = OFFICE_A) => env.ds.query('SELECT * FROM office_schedules WHERE office_id = $1 ORDER BY weekday', [officeId]);
const audits = () => env.ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = 'OFFICE_SCHEDULE_UPDATED' ORDER BY created_at`);
const syncCount = async () => (await env.ds.query('SELECT count(*)::int AS n FROM sync_log'))[0].n;

describe('database', () => {
  it('has the columns, a primary key of office and weekday, a foreign key to offices, and a version', async () => {
    const columns = await env.ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'office_schedules' ORDER BY column_name`);
    assert.deepEqual(columns.map((c) => c.column_name), ['closes_at', 'closes_for_lunch', 'is_working', 'lunch_end', 'lunch_start', 'office_id', 'opens_at', 'updated_at', 'version', 'weekday']);
    const [pk] = await env.ds.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'office_schedules'::regclass AND contype = 'p'`);
    assert.equal(pk.def, 'PRIMARY KEY (office_id, weekday)');
    const [fk] = await env.ds.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'office_schedules_office_fk'`);
    assert.match(fk.def, /FOREIGN KEY \(office_id\) REFERENCES offices\(office_id\)/);
    const unknown = '99999999-9999-4999-8999-999999999999';
    await assert.rejects(env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 1)', [unknown]), (e) => e.code === '23503');
  });

  it('refuses a second row for the same office and weekday, and a weekday outside 0 to 6', async () => {
    await env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 1)', [OFFICE_A]);
    await assert.rejects(env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 1)', [OFFICE_A]), (e) => e.code === '23505');
    await env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 1)', [OFFICE_B]); // another office may have the same weekday
    for (const weekday of [-1, 7]) {
      await assert.rejects(env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, $2)', [OFFICE_A, weekday]), (e) => e.code === '23514');
    }
  });

  it('the version starts at 1 on a row, and the rules for hours and lunch hold in the database too', async () => {
    await env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 2)', [OFFICE_A]);
    assert.equal((await rows())[0].version, 1);
    const set = (sql, args) => env.ds.query(`UPDATE office_schedules SET ${sql} WHERE office_id = $1 AND weekday = 2`, [OFFICE_A, ...args]);
    await assert.rejects(set('is_working = true, opens_at = $2, closes_at = $3', ['17:00', '08:00']), (e) => e.code === '23514');
    await assert.rejects(set('is_working = true, opens_at = $2, closes_at = $2', ['08:00']), (e) => e.code === '23514');
    await assert.rejects(set('is_working = false, opens_at = $2', ['08:00']), (e) => e.code === '23514');
    await assert.rejects(set('version = 0', []), (e) => e.code === '23514');
    await set('is_working = true, opens_at = $2, closes_at = $3', ['08:00', '17:00']);
    await assert.rejects(set('closes_for_lunch = true, lunch_start = $2, lunch_end = $3', ['07:00', '08:30']), (e) => e.code === '23514', 'lunch before opening');
    await assert.rejects(set('closes_for_lunch = true, lunch_start = $2, lunch_end = $3', ['16:00', '18:00']), (e) => e.code === '23514', 'lunch after closing');
    await assert.rejects(set('closes_for_lunch = true, lunch_start = $2, lunch_end = $3', ['13:00', '12:00']), (e) => e.code === '23514', 'lunch ends before it starts');
    await assert.rejects(set('closes_for_lunch = false, lunch_start = $2', ['12:00']), (e) => e.code === '23514', 'lunch times kept while the setting is off');
    await set('closes_for_lunch = true, lunch_start = $2, lunch_end = $3', ['12:00', '13:00']);
  });

  it('the migration is idempotent: running it again changes nothing and adds no rows or duplicate constraints', async () => {
    const names = async () => (await env.ds.query(`SELECT conname FROM pg_constraint WHERE conrelid IN ('office_schedules'::regclass, 'office_schedule_versions'::regclass) ORDER BY conname`)).map((r) => r.conname);
    await env.ds.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 3)', [OFFICE_A]);
    const before = await names();
    await migrateSprint5Core(env.ds);
    await migrateSprint5Core(env.ds);
    assert.deepEqual(await names(), before);
    assert.equal((await rows()).length, 1);
  });

  it('the migration builds the tables on an existing Core database that has none, and is safe to run twice', async () => {
    const database = await createTestDatabase({ entities: [] });
    try {
      const old = database.dataSource;
      await old.query('CREATE TABLE offices (office_id uuid PRIMARY KEY, office_code text, office_name text)');
      await old.query(`INSERT INTO offices VALUES ($1, 'OFA', 'Office A')`, [OFFICE_A]);
      await migrateSprint5Core(old);
      await migrateSprint5Core(old);
      assert.equal((await old.query('SELECT count(*)::int AS n FROM office_schedules'))[0].n, 0, 'nothing is copied into an office');
      await old.query('INSERT INTO office_schedules (office_id, weekday, is_working, opens_at, closes_at) VALUES ($1, 1, true, $2, $3)', [OFFICE_A, '08:00', '17:00']);
      await assert.rejects(old.query('INSERT INTO office_schedules (office_id, weekday) VALUES ($1, 1)', [OFFICE_A]), (e) => e.code === '23505');
      await assert.rejects(old.query('INSERT INTO office_schedules (office_id, weekday, is_working, opens_at, closes_at) VALUES ($1, 2, true, $2, $3)', [OFFICE_A, '17:00', '08:00']), (e) => e.code === '23514');
    } finally {
      await database.drop();
    }
  });

  it('an office with no schedule rows is "uses the campus schedule": nothing is created by reading it', async () => {
    const r = await get();
    assert.equal(r.status, 200);
    assert.equal(r.body.uses_campus_schedule, true);
    assert.equal(r.body.version, 0);
    assert.equal(r.body.office_id, OFFICE_A);
    assert.equal(r.body.items.length, 7);
    assert.deepEqual(r.body.items.map((i) => [i.day_of_week, i.is_working, i.opening_time, i.closing_time]), [[0, false, null, null], [1, true, '08:00', '17:00'], [2, true, '08:00', '17:00'], [3, true, '08:00', '17:00'], [4, true, '08:00', '17:00'], [5, true, '08:00', '17:00'], [6, false, null, null]]);
    assert.ok(r.body.items.every((i) => i.closes_for_lunch === false && i.lunch_start === null && i.lunch_end === null));
    assert.equal((await rows()).length, 0);
    assert.equal((await rows(OFFICE_B)).length, 0);
  });
});

describe('authorization', () => {
  it('Super Admin reads and changes any office\'s schedule', async () => {
    assert.equal((await get(OFFICE_A)).status, 200);
    const saved = await put(WEEK, 0, OFFICE_B);
    assert.equal(saved.status, 200);
    assert.equal((await reset(saved.body.version, OFFICE_B)).status, 200);
  });

  it('an Office Head reads their own office\'s schedule', async () => {
    await put(WEEK, 0);
    const r = await get(OFFICE_A, tokens.officeHeadA);
    assert.equal(r.status, 200);
    assert.equal(r.body.uses_campus_schedule, false);
    assert.equal(r.body.items.length, 7);
  });

  it('an Office Head cannot read another office\'s schedule', async () => {
    assert.equal((await get(OFFICE_B, tokens.officeHeadA)).status, 403);
  });

  it('an Office Head cannot change or reset a schedule, their own included, and nothing is written', async () => {
    assert.equal((await put(WEEK, 0, OFFICE_A, tokens.officeHeadA)).status, 403);
    assert.equal((await put(WEEK, 0, OFFICE_B, tokens.officeHeadA)).status, 403);
    assert.equal((await reset(0, OFFICE_A, tokens.officeHeadA)).status, 403);
    assert.equal((await rows()).length, 0);
    assert.equal((await audits()).length, 0);
  });

  it('Office Staff are refused everything; an Executive may read but not change', async () => {
    assert.equal((await get(OFFICE_A, tokens.officeStaffA)).status, 403);
    assert.equal((await put(WEEK, 0, OFFICE_A, tokens.officeStaffA)).status, 403);
    assert.equal((await reset(0, OFFICE_A, tokens.officeStaffA)).status, 403);
    assert.equal((await get(OFFICE_A, tokens.executive)).status, 200);
    assert.equal((await put(WEEK, 0, OFFICE_A, tokens.executive)).status, 403);
    assert.equal((await reset(0, OFFICE_A, tokens.executive)).status, 403);
    assert.equal((await rows()).length, 0);
  });

  it('no token is a 401, a wrong office is a 404, and the service key is not enough', async () => {
    for (const handler of [getRoute, putRoute]) {
      const response = await handler(req('GET', `/offices/${OFFICE_A}/schedule`), ctx(OFFICE_A));
      assert.equal(response.status, 401);
    }
    assert.equal((await get('99999999-9999-4999-8999-999999999999')).status, 404);
    assert.equal((await get('not-an-id')).status, 404);
    assert.equal((await put(WEEK, 0, '99999999-9999-4999-8999-999999999999')).status, 404);
    const withKey = await getRoute(req('GET', `/offices/${OFFICE_A}/schedule`, { key: 'test-service-key-0123456789' }), ctx(OFFICE_A));
    assert.equal(withKey.status, 401);
  });
});

describe('validation: the whole week is checked and the invalid field is named', () => {
  const problems = async (days, version = 0) => {
    const r = await put(days, version);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal((await rows()).length, 0, 'a refused schedule saves nothing');
    assert.equal((await audits()).length, 0, 'a refused schedule is not audited as a change');
    return r.body.error.details;
  };

  it('closing before opening is refused and names the closing time of that day', async () => {
    const details = await problems(without(WEEK, 2, { opening_time: '17:00', closing_time: '08:00' }));
    assert.deepEqual(Object.keys(details), ['days[2].closing_time']);
    assert.equal(details['days[2].closing_time'], 'Closing time must be after opening time');
  });

  it('closing equal to opening is refused', async () => {
    assert.deepEqual(Object.keys(await problems(without(WEEK, 3, { opening_time: '09:00', closing_time: '09:00' }))), ['days[3].closing_time']);
  });

  it('lunch outside the opening hours is refused, naming the lunch field', async () => {
    const early = await problems(without(WEEK, 1, { lunch_start: '07:00', lunch_end: '08:30' }));
    assert.equal(early['days[1].lunch_start'], 'Lunch must start within the opening hours');
    const late = await problems(without(WEEK, 1, { lunch_start: '16:00', lunch_end: '18:00' }));
    assert.equal(late['days[1].lunch_end'], 'Lunch must end within the opening hours');
    const atClose = await problems(without(WEEK, 1, { lunch_start: '17:00', lunch_end: '17:30' }));
    assert.ok(atClose['days[1].lunch_start'] || atClose['days[1].lunch_end']);
  });

  it('lunch ending before or at its start is refused', async () => {
    assert.equal((await problems(without(WEEK, 4, { lunch_start: '13:00', lunch_end: '12:00' })))['days[4].lunch_end'], 'Lunch end must be after lunch start');
    assert.equal((await problems(without(WEEK, 4, { lunch_start: '12:00', lunch_end: '12:00' })))['days[4].lunch_end'], 'Lunch end must be after lunch start');
  });

  it('lunch times are required when the office closes for lunch, and must be real times', async () => {
    const missing = await problems(without(WEEK, 5, { lunch_start: null, lunch_end: null }));
    assert.deepEqual(Object.keys(missing).sort(), ['days[5].lunch_end', 'days[5].lunch_start']);
    assert.equal((await problems(without(WEEK, 5, { lunch_start: '25:00' })))['days[5].lunch_start'], 'Time must be in 24-hour HH:MM format');
  });

  it('a schedule with all seven days non-working is refused', async () => {
    const details = await problems([0, 1, 2, 3, 4, 5, 6].map((d) => row(d, false)));
    assert.deepEqual(details, { days: 'At least one working day is required' });
  });

  it('refuses the version being missing or not a number, and a week that is not seven distinct days', async () => {
    for (const version of [undefined, null, 'one', -1, 1.5]) {
      const r = await call(putRoute, 'PUT', OFFICE_A, { body: { version, days: WEEK } });
      assert.equal(r.status, 400, String(version));
      assert.ok(r.body.error.details.version);
    }
    assert.ok((await problems(WEEK.slice(0, 6))).days);
    assert.ok((await problems([...WEEK.slice(0, 6), WEEK[0]])).days);
    assert.ok((await problems(WEEK.map((d) => ({ ...d, day_of_week: 9 })))).days);
  });

  it('every problem is reported at once, not only the first', async () => {
    let days = without(WEEK, 1, { opening_time: '17:00', closing_time: '08:00' });
    days = without(days, 2, { lunch_start: '13:00', lunch_end: '12:00' });
    days = without(days, 3, { opening_time: null });
    const details = await problems(days);
    assert.ok(details['days[1].closing_time'] && details['days[2].lunch_end'] && details['days[3].opening_time']);
  });

  it('a non-working day cannot carry hours or a lunch break', async () => {
    assert.ok((await problems(without(WEEK, 0, { opening_time: '08:00' })))['days[0].opening_time']);
    assert.ok((await problems(without(WEEK, 0, { closes_for_lunch: true })))['days[0].closes_for_lunch']);
  });

  it('a valid schedule is accepted and returned as saved', async () => {
    const r = await put(WEEK, 0);
    assert.equal(r.status, 200);
    assert.equal(r.body.uses_campus_schedule, false);
    assert.equal(r.body.version, 1);
    assert.deepEqual(r.body.items, WEEK);
    assert.equal((await rows()).length, 7);
    assert.ok((await rows()).every((x) => x.version === 1));
    assert.deepEqual((await get()).body.items, WEEK);
  });

  it('when lunch is off, lunch times that were sent are not kept and do not count', async () => {
    const r = await put(without(WEEK, 2, { closes_for_lunch: false, lunch_start: '12:00', lunch_end: '13:00' }), 0);
    assert.equal(r.status, 200);
    const tuesday = r.body.items.find((i) => i.day_of_week === 2);
    assert.deepEqual([tuesday.closes_for_lunch, tuesday.lunch_start, tuesday.lunch_end], [false, null, null]);
    assert.equal((await rows()).find((x) => x.weekday === 2).lunch_start, null);
  });
});

describe('versions and conflicts', () => {
  it('the first save needs version 0 and the version then goes up by one on every change', async () => {
    assert.equal((await put(WEEK, 0)).body.version, 1);
    assert.equal((await put(without(WEEK, 6, { opening_time: '09:00' }), 1)).body.version, 2);
    assert.equal((await put(without(WEEK, 6, { opening_time: '10:00' }), 2)).body.version, 3);
    assert.equal((await get()).body.version, 3);
    assert.ok((await rows()).every((x) => x.version === 3));
  });

  it('a stale version is a 409 that names the current version, and the newer schedule is not overwritten', async () => {
    await put(WEEK, 0);
    await put(without(WEEK, 6, { opening_time: '09:00' }), 1); // another administrator saves: version 2
    const before = await rows();
    const stale = await put(without(WEEK, 6, { opening_time: '07:00' }), 1);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'OFFICE_SCHEDULE_VERSION_CONFLICT');
    assert.equal(stale.body.error.details.current_version, 2);
    assert.deepEqual(await rows(), before);
    assert.equal((await get()).body.items.find((i) => i.day_of_week === 6).opening_time, '09:00');
    const ahead = await put(WEEK, 7);
    assert.equal(ahead.status, 409, 'a version from the future is stale too');
  });

  it('saving the schedule the office already has changes nothing: no new version and no audit entry', async () => {
    await put(WEEK, 0);
    const again = await put(WEEK, 1);
    assert.equal(again.status, 200);
    assert.equal(again.body.version, 1);
    assert.equal((await audits()).length, 1);
  });

  it('two saves at the same moment with the same version: exactly one wins, the other is a 409', async () => {
    const results = await Promise.all([put(WEEK, 0), put(without(WEEK, 6, { opening_time: '09:00' }), 0)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await get()).body.version, 1);
    assert.equal((await audits()).length, 1);
  });

  it('resetting to the campus schedule needs the current version, takes the next one, and removes the office\'s rows', async () => {
    await put(WEEK, 0);
    assert.equal((await reset(0)).status, 409, 'stale version');
    assert.equal((await rows()).length, 7);
    const r = await reset(1);
    assert.equal(r.status, 200);
    assert.equal(r.body.uses_campus_schedule, true);
    assert.equal(r.body.version, 2);
    assert.equal((await rows()).length, 0);
    assert.equal((await get()).body.uses_campus_schedule, true);
    const noVersion = await call(resetRoute, 'DELETE', OFFICE_A);
    assert.equal(noVersion.status, 400);
  });

  it('a version number is never reused after a reset: an editor holding an old version cannot save over the new schedule', async () => {
    await put(WEEK, 0); // 1
    await reset(1); // 2: back to the campus schedule
    const newer = await put(without(WEEK, 6, { opening_time: '09:00' }), 2); // 3
    assert.equal(newer.body.version, 3);
    assert.equal((await put(WEEK, 1)).status, 409, 'the editor that loaded version 1 is stale');
    assert.equal((await put(WEEK, 2)).status, 409);
  });

  it('resetting an office that already uses the campus schedule leaves it as it is', async () => {
    const r = await reset(0);
    assert.equal(r.status, 200);
    assert.equal(r.body.version, 0);
    assert.equal((await audits()).length, 0);
  });

  it('one office\'s version and rows are separate from another\'s', async () => {
    await put(WEEK, 0, OFFICE_A);
    assert.equal((await get(OFFICE_B)).body.version, 0);
    assert.equal((await put(without(WEEK, 6, { opening_time: '09:00' }), 0, OFFICE_B)).body.version, 1);
    assert.equal((await rows(OFFICE_A)).find((x) => x.weekday === 6).opens_at, '08:00');
  });
});

describe('audit: OFFICE_SCHEDULE_UPDATED', () => {
  it('a successful save records the office, the actor, the time and the schedule before and after, with versions', async () => {
    assert.equal((await put(WEEK, 0)).status, 200);
    const events = await audits();
    assert.equal(events.length, 1);
    const p = events[0].payload;
    assert.equal(p.action, 'OFFICE_SCHEDULE_UPDATED');
    assert.equal(p.entity_type, 'office_schedule');
    assert.equal(p.entity_id, OFFICE_A);
    assert.equal(p.office_id, OFFICE_A);
    assert.equal(p.actor_role, 'super_admin');
    assert.match(p.occurred_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([p.before_value.uses_campus_schedule, p.before_value.version, p.before_value.items], [true, 0, null]);
    assert.deepEqual([p.after_value.uses_campus_schedule, p.after_value.version], [false, 1]);
    assert.deepEqual(p.after_value.items, WEEK);
  });

  it('a second change shows the earlier schedule as its "before"; a reset is recorded too', async () => {
    await put(WEEK, 0);
    const changed = without(WEEK, 6, { opening_time: '09:00' });
    await put(changed, 1);
    await reset(2);
    const [, second, third] = (await audits()).map((e) => e.payload);
    assert.deepEqual(second.before_value.items, WEEK);
    assert.deepEqual(second.after_value.items, changed);
    assert.deepEqual([second.before_value.version, second.after_value.version], [1, 2]);
    assert.deepEqual([third.before_value.version, third.after_value.version, third.after_value.uses_campus_schedule, third.after_value.items], [2, 3, true, null]);
  });

  it('a refused or stale save is not recorded as a change and leaves the saved schedule alone', async () => {
    await put(WEEK, 0);
    const before = { audits: (await audits()).length, rows: await rows() };
    assert.equal((await put(without(WEEK, 2, { closing_time: '07:00' }), 1)).status, 400);
    assert.equal((await put(without(WEEK, 6, { opening_time: '07:00' }), 0)).status, 409);
    assert.equal((await put(WEEK, 1, OFFICE_A, tokens.officeHeadA)).status, 403);
    assert.equal((await audits()).length, before.audits);
    assert.deepEqual(await rows(), before.rows);
  });

  it('the campus schedule\'s own audit event is unchanged', async () => {
    assert.equal((await putCampus(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: CHARTER_DAYS } }))).status, 200);
    const [event] = await env.ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = 'WORKING_HOURS_UPDATED' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(event.payload.entity_id, 'campus');
  });
});

describe('FMS and SCMS never hear about an office schedule', () => {
  const pull = async () => {
    const response = await declarationsRoute(req('GET', '/declarations?from=2026-08-17&to=2026-12-12', { token: machineKey }));
    return { status: response.status, body: await response.json() };
  };

  it('saving, changing and resetting an office schedule queues no message for FMS and none for SCMS', async () => {
    assert.equal(await syncCount(), 0);
    await put(WEEK, 0);
    await put(without(WEEK, 6, { opening_time: '09:00' }), 1);
    await reset(2);
    assert.equal(await syncCount(), 0, 'no sync row of any kind');
    for (const consumer of ['FMS', 'AUDIT']) {
      assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM sync_log WHERE consumer_system = $1', [consumer]))[0].n, 0, consumer);
    }
  });

  it('the control: the campus schedule does queue its own event, so the check above can fail', async () => {
    await putCampus(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: DEFAULT_DAYS } }));
    await env.ds.query('DELETE FROM sync_log');
    await putCampus(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: CHARTER_DAYS } }));
    const consumers = (await env.ds.query('SELECT consumer_system, event_type FROM sync_log')).map((r) => `${r.consumer_system}:${r.event_type}`);
    assert.deepEqual(consumers, ['AUDIT:WORKING_HOURS_UPDATED']);
  });

  it('the cal-1.0 pull answer is identical before and after office schedule changes', async () => {
    const before = await pull();
    assert.equal(before.status, 200);
    await put(WEEK, 0);
    await put(without(WEEK, 6, { opening_time: '09:00' }), 1);
    const during = await pull();
    await reset(2);
    const after = await pull();
    assert.deepEqual(during.body, before.body);
    assert.deepEqual(after.body, before.body);
    assert.equal(before.body.schemaVersion, 'cal-1.0');
    assert.doesNotMatch(JSON.stringify(after.body), /lunch|office_schedule|opens_at|closes_at/i);
  });

  it('nothing that builds or sends a calendar message knows about office schedules (source check)', () => {
    for (const file of ['src/lib/calendar/message.js', 'src/lib/calendar/sync.js', 'src/lib/calendar/sync-dispatch.js', 'src/lib/calendar/sms-snapshot.js', 'src/lib/calendar/declarations.js']) {
      assert.doesNotMatch(read(file), /office[-_]?schedule|OfficeSchedule|lunch/i, file);
    }
    const service = read('src/lib/calendar/office-schedule.js');
    assert.doesNotMatch(service, /enqueueSync|enqueueCalendarChange|kickSync|SyncLog|from '\.\/sync/, 'the office schedule service queues nothing');
    assert.doesNotMatch(read('src/app/api/offices/[id]/schedule/route.js'), /enqueue|kickSync|SyncLog|from '[^']*sync/);
  });
});
