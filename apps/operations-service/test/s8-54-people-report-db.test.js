import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { readPeopleReport } from '../src/modules/reports/people.js';
import { GET } from '../src/app/api/reports/people/route.js';
import { OFFICE_A, OFFICE_B, USERS, call, insertTransaction, req, resetData, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); await resetData(env.ds); });
after(async () => env?.teardown());
const query = (scope = 'all_staff', personId) => new URLSearchParams({ scope, office_id: OFFICE_A,
  from: '2026-10-01', to: '2026-10-31', ...(personId ? { person_id: personId } : {}) });

test('S8-54 SQL excludes reserved/provenance seeds, reconciles totals and hides former identities from Office Head', async () => {
  const former = randomUUID();
  let sequence = 1;
  const insert = (startedBy, minutes, held, over = {}) => insertTransaction(env.ds, {
    tracking_no: `PUP-OSAS-20261005-${String(sequence++).padStart(4, '0')}`,
    office_id: OFFICE_A, started_by: startedBy, status: 'COMPLETED', started_at: '2026-10-05T01:00:00Z',
    ended_at: '2026-10-05T02:00:00Z', elapsed_working_minutes: minutes, variance_minutes: minutes - 20,
    held_minutes: held, is_compliant: minutes <= 20, ...over,
  });
  const rated = await insert(USERS.staffA, 10, 2);
  await insert(USERS.staffA2, 30, 3);
  await insert(former, 20, 4);
  await insert(USERS.staffA, 1000, 0, { tracking_no: 'PUP-OSAS-20261005-9001' });
  const provenance = await insert(USERS.staffA, 500, 0);
  await insert(USERS.staffB, 10, 0, { office_id: OFFICE_B });
  await insert(USERS.staffA, 10, 0, { started_at: '2026-10-31T16:00:00Z', ended_at: '2026-11-01T02:00:00Z' });
  await env.ds.query(`INSERT INTO service_ratings (rating_id,transaction_id,rating_code,office_id,service_id,service_code,service_name,stars,rated_at)
    VALUES ($1,$2,'ABCDEFGHJKMN',$3,$4,'CODE','Service',4,now())`, [randomUUID(), rated.transaction_id, OFFICE_A, rated.service_id]);
  const runner = env.ds.createQueryRunner();
  await runner.connect(); await runner.startTransaction();
  try {
    // Exercise provenance matching without creating/importing seeded production data.
    await runner.query('CREATE TEMP TABLE seeded_transactions (transaction_id uuid) ON COMMIT DROP');
    await runner.query('INSERT INTO seeded_transactions VALUES ($1)', [provenance.transaction_id]);
    const db = { query: (sql, args) => runner.query(sql, args) };
    const actor = { id: USERS.headA, officeId: OFFICE_A, role: ROLES.OFFICE_HEAD };
    const roster = async () => [USERS.headA, USERS.staffA, USERS.staffA2].map((id) => ({ account_id: id, full_name: `Current ${id}` }));
    const all = await readPeopleReport(db, actor, query(), { roster });
    const office = await readPeopleReport(db, actor, query('office'), { roster });
    assert.equal(all.totals.handled, 3);
    assert.equal(all.excluded_seed_count, 2);
    assert.equal(all.totals.on_time, 2);
    assert.equal(all.totals.on_time_percent, 66.67);
    assert.equal(all.totals.median_working_minutes, 20);
    assert.equal(all.totals.paused_minutes, 9);
    assert.equal(all.totals.rating_average, 4);
    assert.deepEqual(all.totals, office.totals);
    assert.equal(all.items.reduce((sum, p) => sum + p.handled, 0), office.totals.handled);
    assert.equal(all.items.reduce((sum, p) => sum + p.paused_minutes, 0), office.totals.paused_minutes);
    assert.ok(all.items.some((p) => p.person_id === null && p.handled === 1));
    assert.equal(JSON.stringify(all).includes(former), false);
    const own = await readPeopleReport(db, { id: USERS.staffA, officeId: OFFICE_A, role: ROLES.OFFICE_STAFF }, query('person', USERS.staffA));
    assert.equal(own.totals.handled, 1);
    assert.equal(own.items.length, 1);
    assert.equal(own.items[0].person_id, USERS.staffA);
    assert.equal(own.excluded_seed_count, 2);
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM transactions'))[0].n, 7);
  } finally { await runner.rollbackTransaction(); await runner.release(); }
});

test('S8-54 HTTP auth and staff switch enforce own-report access', async () => {
  const path = `/reports/people?${query('person', USERS.staffA)}`;
  assert.equal((await call(GET, req('GET', path))).status, 401);
  assert.equal((await call(GET, req('GET', path, { token: tokens.executive }))).status, 403);
  assert.equal((await call(GET, req('GET', path, { token: tokens.officeStaffA2 }))).status, 403);
  switchState.STAFF_VIEW_REPORTS = false;
  try { assert.equal((await call(GET, req('GET', path, { token: tokens.officeStaffA }))).status, 403); }
  finally { switchState.STAFF_VIEW_REPORTS = true; }
  const own = await call(GET, req('GET', path, { token: tokens.officeStaffA }));
  assert.equal(own.status, 200);
  assert.ok(own.body.items.every((p) => p.person_id === USERS.staffA));
});
