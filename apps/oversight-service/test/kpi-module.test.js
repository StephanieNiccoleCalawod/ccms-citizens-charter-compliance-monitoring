// Sprint 5 TT3: the one KPI module. Pure figures from a fixed 20-row fixture, the period boundaries, who may ask for what, and the
// same figures through the route on a real database (as the restricted runtime role).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ROLES, createDataSource, setDataSource } from 'ccms-shared';
import { GET as kpiRoute } from '../src/app/api/analytics/kpis/route.js';
import { entities } from '../src/lib/entities/index.js';
import { computeKpis, getKpis } from '../src/modules/analytics/kpi.js';
import { periodBounds, resolvePeriod } from '../src/modules/analytics/period.js';
import { OFFICE_A, OFFICE_B, USERS, call, req, roleUrl, setupTestEnv, tokens } from './helpers.js';

const S1 = USERS.headA; // staff account ids are plain values here
const S2 = USERS.staffA;
const SERVICE_1 = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-09T00:00:00Z');
const OCT = { from: '2026-10-01', to: '2026-10-31' };

// Manila is UTC+8. Times below are UTC.
const row = (over = {}) => ({
  transaction_id: randomUUID(), office_id: OFFICE_A, service_id: SERVICE_1, started_at: '2026-10-05T01:00:00Z', ended_at: null, status: 'IN_PROGRESS',
  outcome: null, is_compliant: null, variance_minutes: null, elapsed_working_minutes: null, is_backdated: false, started_outside_hours: false,
  registry_status: 'NONE', registry_miss_reason: null, started_by_user_id: S1, ended_by_user_id: null, ...over,
});
const done = (day, elapsed, variance, over = {}) => row({
  started_at: `2026-10-${day}T01:00:00Z`, ended_at: `2026-10-${day}T02:00:00Z`, status: 'COMPLETED', elapsed_working_minutes: elapsed, variance_minutes: variance,
  is_compliant: variance === null ? null : variance <= 0, ended_by_user_id: over.started_by_user_id ?? S1, ...over,
});

// The fixture of the TT3 acceptance test (office A unless noted). The comment says what each row is for.
const FIXTURE = [
  done('05', 30, -30, { outcome: 'GRANTED' }), // 1 on time, early by 30
  done('06', 50, -10, { outcome: 'GRANTED' }), // 2 on time, early by 10
  done('07', 60, 0, { outcome: 'GRANTED', started_by_user_id: S2 }), // 3 exactly on the limit: on time, not early
  done('08', 90, 30, { outcome: 'DISAPPROVED', started_by_user_id: S2 }), // 4 late
  done('09', 150, 90, { outcome: 'GRANTED', ended_by_user_id: S2 }), // 5 late, started by S1 and ended by S2
  done('10', null, null, { started_by_user_id: S2 }), // 6 completed, result not computed yet: awaiting
  row({ started_at: '2026-10-11T01:00:00Z', status: 'CANCELLED' }), // 7
  row({ started_at: '2026-10-12T01:00:00Z', status: 'CANCELLED', started_by_user_id: S2 }), // 8
  row({ started_at: '2026-10-13T01:00:00Z', status: 'AUTO_CLOSED' }), // 9 auto-closed past its deadline: Late (auto-closed) inside the rate
  row({ started_at: '2026-10-14T01:00:00Z', status: 'AUTO_CLOSED', is_compliant: true }), // 10 closed before its deadline: stays out of the rate
  row({ started_at: '2026-10-06T00:00:00Z' }), // 11 open, the oldest
  row({ started_at: '2026-10-20T00:00:00Z', status: 'ON_HOLD', started_by_user_id: S2 }), // 12 open on hold
  done('15', 20, -40, { is_backdated: true, started_outside_hours: true }), // 13 backdated (outside hours is then not counted twice), outcome not recorded
  done('16', 100, 40, { started_outside_hours: true, outcome: 'GRANTED', started_by_user_id: S2 }), // 14 started outside hours, late
  done('17', 40, -20, { registry_status: 'NOT_FOUND', registry_miss_reason: 'OTHER', outcome: 'GRANTED' }), // 15 not in the registry
  row({ started_at: '2026-10-21T01:00:00Z', registry_status: 'EXPIRED', registry_miss_reason: 'NAME_DIFFERS', started_by_user_id: S2 }), // 16 open, expired
  row({ started_at: '2026-09-30T01:00:00Z', ended_at: '2026-10-02T02:00:00Z', status: 'COMPLETED', elapsed_working_minutes: 10, variance_minutes: -50, is_compliant: true, outcome: 'GRANTED', ended_by_user_id: S1 }), // 17 received in September, completed in October
  row({ started_at: '2026-10-31T01:00:00Z', ended_at: '2026-10-31T16:30:00Z', status: 'COMPLETED', elapsed_working_minutes: 70, variance_minutes: 10, is_compliant: false, outcome: 'GRANTED' }), // 18 completed at 00:30 on 11/01 Manila
  done('05', 45, -15, { office_id: OFFICE_B, outcome: 'GRANTED', started_by_user_id: randomUUID() }), // 19 office B
  row({ office_id: OFFICE_B, started_at: '2026-10-08T01:00:00Z', started_by_user_id: randomUUID() }), // 20 office B open
];

describe('TT3 computeKpis: the fixture', () => {
  const kpis = (extra = {}) => computeKpis(FIXTURE, { ...OCT, officeId: OFFICE_A, now: NOW, ...extra });

  it('AC1: every figure of the office total has the expected value', () => {
    const t = kpis().totals;
    assert.equal(t.received, 17); // rows 1-16 and 18; row 17 was received in September
    assert.equal(t.backdated, 1);
    assert.equal(t.started_outside_hours, 1); // row 14 only: row 13 is backdated and is counted once
    assert.equal(t.not_in_registry, 2);
    assert.deepEqual(t.not_in_registry_by_reason, { OLDER_ALUMNI: 0, NEW_ENROLLEE: 0, RETURNING_STUDENT: 0, NAME_DIFFERS: 1, OTHER: 1 });
    assert.equal(t.cancelled, 2);
    assert.equal(t.auto_closed, 2);
    assert.deepEqual(t.outcomes, { completed: 10, granted: 7, disapproved: 1, not_recorded: 2 });
    assert.deepEqual(t.results, { on_time: 6, late: 3, late_auto_closed: 1, late_total: 4, awaiting_result: 1, on_time_rate: 60 });
    assert.deepEqual(t.time, { average_minutes: 61.1, median_minutes: 50, p90_minutes: 150 });
    assert.deepEqual(t.early, { count: 5, average_margin_minutes: 30 });
    assert.deepEqual(t.pending, { count: 3, oldest_started_at: '2026-10-06T00:00:00.000Z', oldest_age_minutes: 48_960 });
    assert.equal(Object.keys(t).some((key) => key.startsWith('_')), false, 'no working lists leak into the answer');
  });

  it('a row completed on 11/01 Manila time is received in October and completed in November', () => {
    const nov = computeKpis(FIXTURE, { from: '2026-11-01', to: '2026-11-30', officeId: OFFICE_A, now: NOW }).totals;
    assert.equal(nov.received, 0);
    assert.deepEqual(nov.outcomes, { completed: 1, granted: 1, disapproved: 0, not_recorded: 0 });
    assert.equal(nov.results.late, 1);
    assert.equal(nov.pending.count, 3, 'pending now does not depend on the period');
  });

  it('cancelled and auto-closed are their own lines: never in the on-time rate; an auto-closed late one is tagged', () => {
    const r = kpis().totals.results;
    assert.equal(r.on_time + r.late_total, 10, 'cancelled (2), the early auto-closed row and the awaiting row are not in the divisor');
    assert.equal(r.late_auto_closed, 1);
  });

  it('an empty divisor gives no rate (never 0 and never 100); no rows give zeros and empty statistics', () => {
    const onlyAwaiting = computeKpis([done('10', null, null)], { ...OCT, now: NOW }).totals;
    assert.equal(onlyAwaiting.results.on_time_rate, null);
    assert.equal(onlyAwaiting.results.awaiting_result, 1);
    const none = computeKpis([], { ...OCT, now: NOW });
    assert.equal(none.totals.received, 0);
    assert.equal(none.totals.results.on_time_rate, null);
    assert.deepEqual(none.totals.time, { average_minutes: null, median_minutes: null, p90_minutes: null });
    assert.deepEqual(none.totals.early, { count: 0, average_margin_minutes: null });
    assert.deepEqual(none.totals.pending, { count: 0, oldest_started_at: null, oldest_age_minutes: null });
    assert.deepEqual(none.groups, []);
  });

  it('groupBy=staff: starts by the starter, results by the ender', () => {
    const { groups } = kpis({ groupBy: 'staff' });
    const byUser = Object.fromEntries(groups.map((g) => [g.user_id, g]));
    assert.deepEqual(Object.keys(byUser).sort(), [S1, S2].sort());
    assert.equal(byUser[S1].received, 10);
    assert.equal(byUser[S2].received, 7);
    assert.deepEqual(byUser[S1].results, { on_time: 5, late: 0, late_auto_closed: 1, late_total: 1, awaiting_result: 0, on_time_rate: 83.3 });
    assert.deepEqual(byUser[S2].results, { on_time: 1, late: 3, late_auto_closed: 0, late_total: 3, awaiting_result: 1, on_time_rate: 25 });
    assert.equal(byUser[S1].pending.count, 1);
    assert.equal(byUser[S2].pending.count, 2);
  });

  it('groupBy=office and groupBy=service carry their key and add up to the campus total', () => {
    const campus = computeKpis(FIXTURE, { ...OCT, groupBy: 'office', now: NOW });
    assert.deepEqual(campus.groups.map((g) => g.office_id).sort(), [OFFICE_A, OFFICE_B].sort());
    assert.equal(campus.groups.reduce((sum, g) => sum + g.received, 0), campus.totals.received);
    const b = campus.groups.find((g) => g.office_id === OFFICE_B);
    assert.equal(b.received, 2);
    assert.deepEqual(b.results, { on_time: 1, late: 0, late_auto_closed: 0, late_total: 0, awaiting_result: 0, on_time_rate: 100 });
    assert.equal(computeKpis(FIXTURE, { ...OCT, groupBy: 'service', now: NOW }).groups[0].service_id, SERVICE_1);
  });

  it('the service filter applies to every figure', () => {
    assert.equal(computeKpis(FIXTURE, { ...OCT, serviceId: randomUUID(), now: NOW }).totals.received, 0);
  });
});

describe('TT3 periods (AC4)', () => {
  it('weekly runs Monday to Sunday', () => {
    assert.deepEqual(periodBounds('weekly', '2026-10-07'), { type: 'weekly', from: '2026-10-05', to: '2026-10-11' }); // a Wednesday
    assert.deepEqual(periodBounds('weekly', '2026-10-11'), { type: 'weekly', from: '2026-10-05', to: '2026-10-11' }); // the Sunday
    assert.deepEqual(periodBounds('weekly', '2026-10-05'), { type: 'weekly', from: '2026-10-05', to: '2026-10-11' }); // the Monday
    assert.deepEqual(periodBounds('weekly', '2026-12-31'), { type: 'weekly', from: '2026-12-28', to: '2027-01-03' }); // across a year
  });

  it('monthly follows the calendar, leap years included', () => {
    assert.deepEqual(periodBounds('monthly', '2026-02-10'), { type: 'monthly', from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(periodBounds('monthly', '2028-02-10'), { type: 'monthly', from: '2028-02-01', to: '2028-02-29' });
    assert.deepEqual(periodBounds('monthly', '2026-12-31'), { type: 'monthly', from: '2026-12-01', to: '2026-12-31' });
  });

  it('half-year (the default) and annual', () => {
    assert.deepEqual(periodBounds('half_year', '2026-06-30'), { type: 'half_year', from: '2026-01-01', to: '2026-06-30' });
    assert.deepEqual(periodBounds('half_year', '2026-07-01'), { type: 'half_year', from: '2026-07-01', to: '2026-12-31' });
    assert.deepEqual(periodBounds('annual', '2026-07-01'), { type: 'annual', from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(resolvePeriod(new URLSearchParams(), new Date('2026-11-09T00:00:00Z')), { type: 'half_year', from: '2026-07-01', to: '2026-12-31' });
  });

  it('the default day is the Manila day: 16:30 UTC on 12/31 is already January in Manila', () => {
    assert.deepEqual(resolvePeriod(new URLSearchParams(), new Date('2026-12-31T16:30:00Z')), { type: 'half_year', from: '2027-01-01', to: '2027-06-30' });
  });

  it('custom needs both dates in order; a bad type or date is a 400', () => {
    assert.deepEqual(resolvePeriod(new URLSearchParams({ from: '2026-10-01', to: '2026-10-15' })), { type: 'custom', from: '2026-10-01', to: '2026-10-15' });
    assert.deepEqual(resolvePeriod(new URLSearchParams({ period: 'custom', from: '2026-10-01', to: '2026-10-15' })).type, 'custom');
    for (const bad of [{ period: 'custom' }, { from: '2026-10-01' }, { from: '2026-10-15', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' }, { period: 'daily' }, { date: '2026-13-01' }]) {
      assert.throws(() => resolvePeriod(new URLSearchParams(bad)), (e) => e.status === 400, JSON.stringify(bad));
    }
  });

  it('a row that starts at 00:00 Manila is in the new half-year; one second earlier is in the old one', () => {
    const rows = [row({ started_at: '2026-06-30T16:00:00Z' }), row({ started_at: '2026-06-30T15:59:59Z' })];
    assert.equal(computeKpis(rows, { from: '2026-07-01', to: '2026-12-31', now: NOW }).totals.received, 1);
    assert.equal(computeKpis(rows, { from: '2026-01-01', to: '2026-06-30', now: NOW }).totals.received, 1);
  });
});

describe('TT3 who may ask (AC2, AC3)', () => {
  const never = { query: async () => { throw new Error('the database must not be read'); } };
  const stub = (rows) => ({ query: async () => rows });
  const q = (o) => new URLSearchParams(o);

  it('AC2: an Executive asking for staff figures is refused before any read', async () => {
    await assert.rejects(getKpis(never, { role: ROLES.EXECUTIVE }, q({ group_by: 'staff' })), (e) => e.status === 403);
    await assert.rejects(getKpis(never, { role: ROLES.EXECUTIVE }, q({ groupBy: 'staff' })), (e) => e.status === 403);
  });

  it('AC3: Office Staff of office A asking for office B are refused before any read', async () => {
    const staff = { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, id: S2 };
    await assert.rejects(getKpis(never, staff, q({ office_id: OFFICE_B })), (e) => e.status === 403);
    await assert.rejects(getKpis(never, staff, q({ officeId: OFFICE_B })), (e) => e.status === 403);
  });

  it('an Executive may read office and campus figures; a bad grouping or id is a 400', async () => {
    const answer = await getKpis(stub(FIXTURE), { role: ROLES.EXECUTIVE }, q({ ...OCT, group_by: 'office' }), NOW);
    assert.equal(answer.groups.length, 2);
    await assert.rejects(getKpis(never, { role: ROLES.EXECUTIVE }, q({ group_by: 'weekday' })), (e) => e.status === 400);
    await assert.rejects(getKpis(never, { role: ROLES.EXECUTIVE }, q({ office_id: 'nope' })), (e) => e.status === 400);
  });

  it('an Office Head sees every staff member of the office; Office Staff only their own row', async () => {
    const head = await getKpis(stub(FIXTURE.filter((r) => r.office_id === OFFICE_A)), { role: ROLES.OFFICE_HEAD, officeId: OFFICE_A, id: randomUUID() }, q({ ...OCT, groupBy: 'staff' }), NOW);
    assert.equal(head.groups.length, 2);
    const staff = await getKpis(stub(FIXTURE.filter((r) => r.office_id === OFFICE_A)), { role: ROLES.OFFICE_STAFF, officeId: OFFICE_A, id: S2 }, q({ ...OCT, groupBy: 'staff' }), NOW);
    assert.deepEqual(staff.groups.map((g) => g.user_id), [S2]);
    assert.equal(staff.totals.received, 17, 'the office total stays an office total');
  });

  it('the answer states its period and the counting basis', async () => {
    const answer = await getKpis(stub([]), { role: ROLES.SUPER_ADMIN }, q(), NOW);
    assert.deepEqual([answer.period, answer.from, answer.to], ['half_year', '2026-07-01', '2026-12-31']);
    assert.match(answer.basis, /start date.*end date/i);
  });
});

describe('TT3 through the route (real database, runtime role)', () => {
  let env;
  let writer;
  before(async () => {
    env = await setupTestEnv();
    writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
    await writer.initialize();
  });
  after(async () => {
    await writer?.destroy();
    await env?.teardown();
  });
  beforeEach(async () => {
    await env.ds.query('DELETE FROM analytics_transactions');
    setDataSource(writer);
  });

  async function insert(r) {
    await env.ds.query(
      `INSERT INTO analytics_transactions (transaction_id, tracking_no, office_id, service_id, service_code, classification, client_type, standard_days, standard_hours, standard_minutes,
         started_at, ended_at, status, elapsed_working_minutes, is_compliant, variance_minutes, held_minutes, is_backdated, started_outside_hours, registry_status, registry_miss_reason, outcome,
         started_by_user_id, ended_by_user_id, event_version, is_seeded)
       VALUES ($1,$2,$3,$4,'PUP-X-001','SIMPLE','STUDENT',0,1,0,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,$17,1,false)`,
      [r.transaction_id, `T-${r.transaction_id.slice(0, 8)}`, r.office_id, r.service_id, r.started_at, r.ended_at, r.status, r.elapsed_working_minutes, r.is_compliant, r.variance_minutes,
        r.is_backdated, r.started_outside_hours, r.registry_status, r.registry_miss_reason, r.outcome, r.started_by_user_id, r.ended_by_user_id],
    );
  }
  const get = (query, token) => call(kpiRoute, req('GET', `/analytics/kpis?${new URLSearchParams(query)}`, { token }));

  it('the database gives the same figures as the pure function', async () => {
    for (const r of FIXTURE) await insert(r);
    const answer = await get({ ...OCT, office_id: OFFICE_A }, tokens.superAdmin);
    assert.equal(answer.status, 200);
    const expected = computeKpis(FIXTURE, { ...OCT, officeId: OFFICE_A, now: new Date(answer.body.generated_at) }).totals;
    assert.deepEqual(answer.body.totals, expected);
    assert.equal(answer.body.totals.results.on_time_rate, 60);
  });

  it('the routes enforce the scope for each role', async () => {
    for (const r of FIXTURE) await insert(r);
    assert.equal((await get({ ...OCT, group_by: 'staff' }, tokens.executive)).status, 403);
    assert.equal((await get({ ...OCT, group_by: 'office' }, tokens.executive)).status, 200);
    assert.equal((await get({ ...OCT, office_id: OFFICE_B }, tokens.officeStaffA)).status, 403);
    const own = await get({ ...OCT, group_by: 'staff' }, tokens.officeStaffA);
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.groups.map((g) => g.user_id), [USERS.staffA]);
    const head = await get({ ...OCT, group_by: 'staff' }, tokens.officeHeadA);
    assert.deepEqual(head.body.groups.map((g) => g.user_id).sort(), [S1, S2].sort());
    assert.equal((await get({ ...OCT }, null)).status, 401);
  });

  it('an Executive answer never contains a staff account id', async () => {
    for (const r of FIXTURE) await insert(r);
    const text = JSON.stringify((await get({ ...OCT, group_by: 'office' }, tokens.executive)).body);
    assert.equal(text.includes(S1) || text.includes(S2), false);
  });
});
