// CC048: the engine endpoints with an office's own schedule, end to end with the database. This file is also run by
// scripts/test-engine-tz.mjs under TZ=UTC and under America/Los_Angeles, so the results must not depend on the server clock.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as postAddMinutes } from '../src/app/api/add-working-minutes/route.js';
import { POST as postDeadline } from '../src/app/api/deadline/route.js';
import { DELETE as removeException, } from '../src/app/api/exceptions/[id]/route.js';
import { POST as postException } from '../src/app/api/exceptions/route.js';
import { GET as isWorkingDay } from '../src/app/api/is-working-day/route.js';
import { DELETE as resetRoute, PUT as putRoute } from '../src/app/api/offices/[id]/schedule/route.js';
import { POST as postMinutes } from '../src/app/api/working-minutes/route.js';
import { OFFICE_A, OFFICE_B, SERVICE_KEY, ctx, req, setupTestEnv, tokens } from './calendar-helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  for (const [id, code, name] of [[OFFICE_A, 'OFA', 'Office A'], [OFFICE_B, 'OFB', 'Office B']]) {
    await env.ds.query('INSERT INTO offices (office_id, office_code, office_name) VALUES ($1, $2, $3)', [id, code, name]);
  }
});
after(async () => env?.teardown());
beforeEach(async () => {
  await env.ds.query('DELETE FROM office_schedules');
  await env.ds.query('DELETE FROM office_schedule_versions');
  await env.ds.query('DELETE FROM calendar_exceptions');
});

const key = { key: SERVICE_KEY };
const post = async (handler, path, body) => {
  const response = await handler(req('POST', path, { ...key, body }));
  return { status: response.status, body: await response.json() };
};
const minutes = (body) => post(postMinutes, '/working-minutes', body);
const addMinutes = (body) => post(postAddMinutes, '/add-working-minutes', body);
const deadline = (body) => post(postDeadline, '/deadline', body);
const day = async (query) => {
  const response = await isWorkingDay(req('GET', `/is-working-day${query}`, key));
  return { status: response.status, body: await response.json() };
};

const row = (dow, working, open = null, close = null, lunch = null) => ({
  day_of_week: dow,
  is_working: working,
  opening_time: working ? open : null,
  closing_time: working ? close : null,
  closes_for_lunch: Boolean(lunch),
  lunch_start: lunch ? lunch[0] : null,
  lunch_end: lunch ? lunch[1] : null,
});
// Office A: Mon-Fri 08:00-17:00 with lunch 12:00-13:00, Saturday 08:00-12:00 (no lunch), Sunday off.
const officeWeek = (lunch = ['12:00', '13:00']) => [row(0, false), ...[1, 2, 3, 4, 5].map((d) => row(d, true, '08:00', '17:00', lunch)), row(6, true, '08:00', '12:00')];
const saveOffice = async (officeId, days, version = 0) => {
  const response = await putRoute(req('PUT', `/offices/${officeId}/schedule`, { token: tokens.superAdmin, body: { version, days } }), ctx(officeId));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
};
const resetOffice = async (officeId, version) => {
  const response = await resetRoute(req('DELETE', `/offices/${officeId}/schedule?version=${version}`, { token: tokens.superAdmin }), ctx(officeId));
  assert.equal(response.status, 200);
  return response.json();
};
// October 2026: Tue 6, Wed 7, Thu 8, Fri 9, Sat 10, Sun 11, Mon 12, Tue 13. The campus schedule is the seeded default (Mon-Fri 08:00-17:00).

describe('AC1: an office without its own schedule gets exactly the campus results', () => {
  const spans = [
    ['2026-10-06T10:00:00+08:00', '2026-10-06T11:30:00+08:00'],
    ['2026-10-06T16:30:00+08:00', '2026-10-07T08:30:00+08:00'],
    ['2026-10-09T16:00:00+08:00', '2026-10-13T09:00:00+08:00'],
    ['2026-10-10T09:00:00+08:00', '2026-10-10T16:00:00+08:00'],
    ['2026-10-06T07:00:00+08:00', '2026-10-13T23:00:00+08:00'],
  ];

  it('working minutes, deadlines, added minutes and working days are identical with and without the office', async () => {
    for (const [start, end] of spans) {
      const campus = await minutes({ start, end });
      const office = await minutes({ start, end, officeId: OFFICE_A });
      assert.equal(office.status, 200);
      assert.deepEqual(office.body, campus.body, `${start} to ${end}`);
    }
    for (const workingDays of [1, 3, 6]) {
      const body = { start: '2026-10-06T10:00:00+08:00', workingDays, heldMinutes: 25 };
      assert.deepEqual((await deadline({ ...body, officeId: OFFICE_A })).body, (await deadline(body)).body);
    }
    for (const minutesToAdd of [0, 45, 700]) {
      const body = { datetime: '2026-10-09T16:30:00+08:00', minutes: minutesToAdd };
      assert.deepEqual((await addMinutes({ ...body, officeId: OFFICE_A })).body, (await addMinutes(body)).body);
    }
    for (const date of ['2026-10-06', '2026-10-10', '2026-10-11']) {
      assert.deepEqual((await day(`?date=${date}&officeId=${OFFICE_A}`)).body, (await day(`?date=${date}`)).body);
    }
  });

  it('a change to the campus schedule still reaches an office that has none of its own', async () => {
    const { PUT: putCampus } = await import('../src/app/api/schedule/route.js');
    const charter = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, is_working: d >= 2, opening_time: d >= 2 ? '08:00' : null, closing_time: d >= 2 ? (d === 6 ? '17:00' : '19:00') : null }));
    assert.equal((await putCampus(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: charter } }))).status, 200);
    assert.equal((await day(`?date=2026-10-10&officeId=${OFFICE_B}`)).body.is_working_day, true);
    const defaults = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, is_working: d >= 1 && d <= 5, opening_time: d >= 1 && d <= 5 ? '08:00' : null, closing_time: d >= 1 && d <= 5 ? '17:00' : null }));
    assert.equal((await putCampus(req('PUT', '/schedule', { token: tokens.superAdmin, body: { days: defaults } }))).status, 200);
  });
});

describe('AC2: one office\'s schedule affects that office only', () => {
  it('Office A works Saturday 08:00-12:00; a Saturday 09:00 start counts for Office A only', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    const span = { start: '2026-10-10T09:00:00+08:00', end: '2026-10-10T10:00:00+08:00' };
    assert.equal((await minutes({ ...span, officeId: OFFICE_A })).body.working_minutes, 60);
    assert.equal((await minutes({ ...span, officeId: OFFICE_B })).body.working_minutes, 0);
    assert.equal((await minutes(span)).body.working_minutes, 0, 'the campus schedule has no Saturday');
    assert.deepEqual((await day(`?date=2026-10-10&officeId=${OFFICE_A}`)).body, { is_working_day: true, window: { opening_time: '08:00', closing_time: '12:00' } });
    assert.deepEqual((await day(`?date=2026-10-10&officeId=${OFFICE_B}`)).body, { is_working_day: false, window: null });
  });

  it('their deadlines follow their own days: counting from Friday, Office A\'s first working day is Saturday, Office B\'s is Monday', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    const body = { start: '2026-10-09T10:00:00+08:00', workingDays: 1 };
    assert.equal((await deadline({ ...body, officeId: OFFICE_A })).body.deadline, '2026-10-10T12:00:00+08:00');
    assert.equal((await deadline({ ...body, officeId: OFFICE_B })).body.deadline, '2026-10-12T17:00:00+08:00');
  });

  it('two offices can each have their own schedule', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    await saveOffice(OFFICE_B, [row(0, true, '09:00', '12:00'), ...[1, 2, 3, 4, 5, 6].map((d) => row(d, false))]);
    assert.equal((await day(`?date=2026-10-11&officeId=${OFFICE_B}`)).body.is_working_day, true);
    assert.equal((await day(`?date=2026-10-11&officeId=${OFFICE_A}`)).body.is_working_day, false);
    assert.equal((await day(`?date=2026-10-06&officeId=${OFFICE_B}`)).body.is_working_day, false);
    assert.equal((await day(`?date=2026-10-06&officeId=${OFFICE_A}`)).body.is_working_day, true);
  });
});

describe('AC3: the lunch break', () => {
  const tuesday = { start: '2026-10-06T11:00:00+08:00', end: '2026-10-06T14:00:00+08:00', officeId: OFFICE_A };

  it('Tuesday 11:00 to 14:00 with lunch 12:00-13:00 is 120 minutes; with lunch off it is 180', async () => {
    const saved = await saveOffice(OFFICE_A, officeWeek());
    assert.equal((await minutes(tuesday)).body.working_minutes, 120);
    await saveOffice(OFFICE_A, officeWeek(null), saved.version);
    assert.equal((await minutes(tuesday)).body.working_minutes, 180);
  });

  it('adding working minutes skips the lunch, and the deadline day still closes at closing time', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    assert.equal((await addMinutes({ datetime: '2026-10-06T11:30:00+08:00', minutes: 60, officeId: OFFICE_A })).body.datetime, '2026-10-06T13:30:00+08:00');
    assert.equal((await deadline({ start: '2026-10-06T10:00:00+08:00', workingDays: 1, officeId: OFFICE_A })).body.deadline, '2026-10-07T17:00:00+08:00');
  });

  it('is-working-day still reports the day\'s outer window (opening to closing), not the lunch', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    assert.deepEqual((await day(`?date=2026-10-06&officeId=${OFFICE_A}`)).body, { is_working_day: true, window: { opening_time: '08:00', closing_time: '17:00' } });
  });
});

describe('a schedule update affects later computations, and nothing already stored', () => {
  it('the answer changes the moment the office saves, and goes back to the campus answer on reset', async () => {
    const span = { start: '2026-10-10T09:00:00+08:00', end: '2026-10-10T11:00:00+08:00', officeId: OFFICE_A };
    assert.equal((await minutes(span)).body.working_minutes, 0);
    const saved = await saveOffice(OFFICE_A, officeWeek());
    assert.equal((await minutes(span)).body.working_minutes, 120);
    await resetOffice(OFFICE_A, saved.version);
    assert.equal((await minutes(span)).body.working_minutes, 0);
  });

  it('a schedule change rewrites no stored dates or holidays (calendar entries are untouched)', async () => {
    await postException(req('POST', '/exceptions', { token: tokens.superAdmin, body: { exception_date: '2026-10-07', exception_type: 'REGULAR_HOLIDAY', description: 'Holiday' } }));
    const before = await env.ds.query('SELECT exception_id, exception_date, revision, updated_at FROM calendar_exceptions');
    const saved = await saveOffice(OFFICE_A, officeWeek());
    await resetOffice(OFFICE_A, saved.version);
    assert.deepEqual(await env.ds.query('SELECT exception_id, exception_date, revision, updated_at FROM calendar_exceptions'), before);
  });
});

describe('holidays and suspensions still apply to an office with its own schedule', () => {
  const add = async (body) => {
    const response = await postException(req('POST', '/exceptions', { token: tokens.superAdmin, body }));
    return { status: response.status, body: await response.json() };
  };

  it('a campus holiday closes the office on that date, and an office-only holiday closes only that office', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    await saveOffice(OFFICE_B, officeWeek());
    assert.equal((await add({ exception_date: '2026-10-06', exception_type: 'REGULAR_HOLIDAY', description: 'Campus holiday' })).status, 201);
    assert.equal((await add({ exception_date: '2026-10-07', exception_type: 'LOCAL_HOLIDAY', description: 'Office A only', office_id: OFFICE_A })).status, 201);
    assert.equal((await minutes({ start: '2026-10-06T09:00:00+08:00', end: '2026-10-06T16:00:00+08:00', officeId: OFFICE_A })).body.working_minutes, 0);
    assert.equal((await minutes({ start: '2026-10-07T09:00:00+08:00', end: '2026-10-07T11:00:00+08:00', officeId: OFFICE_A })).body.working_minutes, 0);
    assert.equal((await minutes({ start: '2026-10-07T09:00:00+08:00', end: '2026-10-07T11:00:00+08:00', officeId: OFFICE_B })).body.working_minutes, 120);
  });

  it('a part-day suspension and the lunch are both taken out of the day', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    assert.equal((await add({ exception_date: '2026-10-08', exception_type: 'SUSPENSION', description: 'Suspension', suspended_from: '12:30', suspended_until: '14:00' })).status, 201);
    const r = await minutes({ start: '2026-10-08T11:00:00+08:00', end: '2026-10-08T15:00:00+08:00', officeId: OFFICE_A });
    assert.equal(r.body.working_minutes, 60 + 60, '11:00-12:00 and 14:00-15:00');
  });

  it('an office suspension is checked against that office\'s own hours: Saturday works for Office A, not for an office on the campus schedule', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    const saturday = { exception_date: '2026-10-10', exception_type: 'SUSPENSION', description: 'Saturday suspension', suspended_from: '09:00', suspended_until: '10:00' };
    assert.equal((await add({ ...saturday, office_id: OFFICE_A })).status, 201);
    const refused = await add({ ...saturday, office_id: OFFICE_B });
    assert.equal(refused.status, 400, 'Office B follows the campus schedule, which has no Saturday');
    assert.match(refused.body.error.details.suspended_from, /not a working day/);
    assert.equal((await minutes({ start: '2026-10-10T08:00:00+08:00', end: '2026-10-10T12:00:00+08:00', officeId: OFFICE_A })).body.working_minutes, 180);
    assert.equal((await minutes({ start: '2026-10-10T08:00:00+08:00', end: '2026-10-10T12:00:00+08:00', officeId: OFFICE_B })).body.working_minutes, 0);
  });

  it('removing an entry gives the day back', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    const created = await add({ exception_date: '2026-10-09', exception_type: 'REGULAR_HOLIDAY', description: 'Holiday' });
    const id = created.body.exception.exception_id;
    const span = { start: '2026-10-09T09:00:00+08:00', end: '2026-10-09T11:00:00+08:00', officeId: OFFICE_A };
    assert.equal((await minutes(span)).body.working_minutes, 0);
    assert.equal((await removeException(req('DELETE', `/exceptions/${id}`, { token: tokens.superAdmin }), ctx(id))).status, 204);
    assert.equal((await minutes(span)).body.working_minutes, 120);
  });
});

describe('the time zone of the server does not matter', () => {
  it('a schedule is read as Asia/Manila wall-clock time whatever the process time zone is', async () => {
    await saveOffice(OFFICE_A, officeWeek());
    // 08:00+08:00 is 00:00 UTC. If anything read the opening time in the server's zone the result would move with TZ.
    assert.equal((await minutes({ start: '2026-10-06T08:00:00+08:00', end: '2026-10-06T17:00:00+08:00', officeId: OFFICE_A })).body.working_minutes, 480);
    assert.equal((await minutes({ start: '2026-10-06T00:00:00Z', end: '2026-10-06T09:00:00Z', officeId: OFFICE_A })).body.working_minutes, 480, 'the same span written in UTC');
    assert.equal((await minutes({ start: '2026-10-06T04:00:00Z', end: '2026-10-06T06:00:00Z', officeId: OFFICE_A })).body.working_minutes, 120 - 60, '12:00-14:00 Manila: lunch hour removed');
    assert.equal((await addMinutes({ datetime: '2026-10-06T03:30:00Z', minutes: 60, officeId: OFFICE_A })).body.datetime, '2026-10-06T13:30:00+08:00');
    if (process.env.CCMS_EXPECT_TZ_OFFSET !== undefined) assert.equal(String(new Date(2026, 0, 15).getTimezoneOffset()), process.env.CCMS_EXPECT_TZ_OFFSET);
  });
});
