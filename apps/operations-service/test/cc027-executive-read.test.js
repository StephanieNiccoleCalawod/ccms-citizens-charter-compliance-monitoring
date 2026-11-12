// CC027 change (K14, Sprint 5-8 spec 6.5): the Executive reads transactions across offices, read-only, and only through the
// allowlisted Executive view. Synthetic fixtures in two offices with every private field populated; real PostgreSQL (TEST_PG_URL).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { GET as detailRoute } from '../src/app/api/transactions/[id]/route.js';
import { POST as cancelRoute } from '../src/app/api/transactions/[id]/cancel/route.js';
import { POST as completeRoute } from '../src/app/api/transactions/[id]/complete/route.js';
import { POST as holdRoute } from '../src/app/api/transactions/[id]/hold/route.js';
import { POST as resumeRoute } from '../src/app/api/transactions/[id]/resume/route.js';
import { GET as listRoute, POST as startRoute } from '../src/app/api/transactions/route.js';
import { EXECUTIVE_TRANSACTION_FIELDS, toExecutiveTransactionDto, toTransactionDto } from '../src/modules/transaction/dto.js';
import { OFFICE_A, OFFICE_B, SERVICE_A, SERVICE_B, USERS, at, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

// Every value below is synthetic and unique, so finding it anywhere in a response is a leak.
const SECRET = Object.freeze({
  staffName: 'Synthetic Staff Name-7Q',
  staffPosition: 'Synthetic Position-7Q',
  clientRef: 'SYNTH-CLIENT-REF-7Q',
  clientEmail: 'synthetic.client.7q@example.test',
  studentNo: 'SYNTH-SN-0007',
  missNote: 'SYNTH-REGISTRY-NOTE-7Q',
  holdReason: 'SYNTH-HOLD-REASON-7Q',
  cancelReason: 'SYNTH-CANCEL-REASON-7Q',
  disapproval: 'SYNTH-DISAPPROVAL-REASON-7Q',
  backdate: 'SYNTH-BACKDATE-REASON-7Q',
  counterLabel: 'SYNTH-WINDOW-7Q',
});

/** Keys that must never be in an Executive response (spec 6.5 "leaves out", plus the plan's client/registry/counter list). */
const FORBIDDEN_KEYS = Object.freeze([
  'started_by', 'started_by_name', 'started_by_position', 'ended_by',
  'client_reference', 'client_email',
  'registry_status', 'registry_student_number', 'registry_miss_reason', 'registry_miss_note',
  'counter_id', 'counter_label',
  'hold_reason', 'cancel_reason', 'disapproval_reason', 'disapproval_notice_given', 'backdate_reason',
  'receipt_email_status', 'receipt_email_attempts', 'acknowledgement_email_status', 'standard_id',
]);

let env;
const rows = {};
let counterId;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
  await resetData(env.ds);
  counterId = randomUUID();
  await env.ds.query(`INSERT INTO counters (counter_id, office_id, label) VALUES ($1, $2, $3)`, [counterId, OFFICE_A, SECRET.counterLabel]);
  const base = new Date(at('2026-10-06', '09:00')).getTime();
  const t = (h) => new Date(base + h * 3_600_000);
  const staffFields = { started_by_name: SECRET.staffName, started_by_position: SECRET.staffPosition };
  // Office A: completed as Disapproved, backdated, with a matched registry record, a counter, client contact and staff copy.
  rows.aDone = await insertTransaction(env.ds, {
    tracking_no: 'PUP-OSAS-20261006-7001', started_by: USERS.staffA, started_at: t(0), ...staffFields,
    client_reference: SECRET.clientRef, client_email: SECRET.clientEmail, counter_id: counterId,
    registry_status: 'MATCHED', registry_student_number: SECRET.studentNo,
    status: 'COMPLETED', ended_at: t(1), ended_by: USERS.headA, elapsed_working_minutes: 60, is_compliant: true, variance_minutes: -5,
    is_backdated: true, backdate_reason: SECRET.backdate,
    outcome: 'DISAPPROVED', disapproval_reason: SECRET.disapproval, disapproval_notice_given: true,
  });
  // Office A: on hold, not found in the registry with a private note.
  rows.aHeld = await insertTransaction(env.ds, {
    tracking_no: 'PUP-OSAS-20261006-7002', started_by: USERS.staffA2, started_at: t(2), ...staffFields, client_email: SECRET.clientEmail,
    registry_status: 'NOT_FOUND', registry_miss_reason: 'OTHER', registry_miss_note: SECRET.missNote,
    status: 'ON_HOLD', hold_started_at: t(3), hold_reason: SECRET.holdReason, held_minutes: 15,
  });
  // Office B: cancelled with a reason, and one still in progress.
  rows.bCancelled = await insertTransaction(env.ds, {
    tracking_no: 'PUP-ACAD-20261006-7001', office_id: OFFICE_B, office_code: 'PUP-ACAD', service_id: SERVICE_B, started_by: USERS.staffB, started_at: t(4),
    ...staffFields, client_reference: SECRET.clientRef, status: 'CANCELLED', ended_at: t(5), cancel_reason: SECRET.cancelReason,
  });
  rows.bOpen = await insertTransaction(env.ds, {
    tracking_no: 'PUP-ACAD-20261006-7002', office_id: OFFICE_B, office_code: 'PUP-ACAD', service_id: SERVICE_B, started_by: USERS.staffB, started_at: t(6),
    ...staffFields, client_email: SECRET.clientEmail,
  });
});
after(async () => env?.teardown());

const list = (query = '', token = tokens.executive) => call(listRoute, req('GET', `/transactions${query}`, { token }));
const detail = (id, token = tokens.executive) => call(detailRoute, req('GET', `/transactions/${id}`, { token }), ctx(id));
const trackingOf = (r) => r.body.items.map((i) => i.tracking_no).sort();
const stateOf = async (id) => (await env.ds.query('SELECT status, outcome, hold_reason, cancel_reason, version FROM transactions WHERE transaction_id = $1', [id]))[0];

/** The one schema check: exactly the allowlist, none of the forbidden keys, and no private value or staff/counter id anywhere. */
function assertExecutiveShape(item, label) {
  assert.deepEqual(Object.keys(item).sort(), [...EXECUTIVE_TRANSACTION_FIELDS].sort(), `${label}: exactly the allowlisted keys`);
  for (const key of FORBIDDEN_KEYS) assert.ok(!(key in item), `${label}: ${key} must be absent (not null)`);
}
function assertNoPrivateValues(body, label) {
  const text = JSON.stringify(body);
  for (const [name, value] of Object.entries(SECRET)) assert.ok(!text.includes(value), `${label}: leaked ${name}`);
  for (const id of [USERS.staffA, USERS.staffA2, USERS.staffB, USERS.headA, counterId]) assert.ok(!text.includes(id), `${label}: leaked an id`);
}

describe('CC027 / K14: Executive list', () => {
  it('reads every office (both offices, every status), newest first, with the page shape of the other roles', async () => {
    const r = await list();
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['items', 'page', 'page_size', 'total']);
    assert.equal(r.body.total, 4);
    assert.deepEqual(trackingOf(r), ['PUP-ACAD-20261006-7001', 'PUP-ACAD-20261006-7002', 'PUP-OSAS-20261006-7001', 'PUP-OSAS-20261006-7002']);
    assert.deepEqual(new Set(r.body.items.map((i) => i.office_id)), new Set([OFFICE_A, OFFICE_B]));
  });

  it('schema test: every item is exactly the allowlist, with no forbidden key or private value', async () => {
    const r = await list('?page_size=100');
    for (const item of r.body.items) assertExecutiveShape(item, item.tracking_no);
    assertNoPrivateValues(r.body, 'list');
  });

  it('keeps what review needs: office, service, client type, status, outcome, timing, result and flags', async () => {
    const done = (await list('?q=PUP-OSAS-20261006-7001')).body.items[0];
    assert.equal(done.office_id, OFFICE_A);
    assert.equal(done.service_id, SERVICE_A);
    assert.equal(done.client_type, 'STUDENT');
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.outcome, 'DISAPPROVED');
    assert.equal(done.is_compliant, true);
    assert.equal(done.variance_minutes, -5);
    assert.equal(done.elapsed_working_minutes, 60);
    assert.equal(done.is_backdated, true);
    assert.equal(done.started_at, rows.aDone.started_at.toISOString());
    const held = (await list('?q=PUP-OSAS-20261006-7002')).body.items[0];
    assert.equal(held.status, 'ON_HOLD');
    assert.equal(held.held_minutes, 15);
    assert.equal(held.outcome, null, 'a transaction that is not completed carries no outcome');
  });

  it('honours explicit filters (office, status, service, dates, tracking number) without an office restriction of its own', async () => {
    assert.deepEqual(trackingOf(await list(`?office_id=${OFFICE_B}`)), ['PUP-ACAD-20261006-7001', 'PUP-ACAD-20261006-7002']);
    assert.deepEqual(trackingOf(await list(`?office_id=${OFFICE_A}`)), ['PUP-OSAS-20261006-7001', 'PUP-OSAS-20261006-7002']);
    assert.deepEqual(trackingOf(await list('?status=CANCELLED')), ['PUP-ACAD-20261006-7001']);
    assert.deepEqual(trackingOf(await list(`?service_id=${SERVICE_B}`)), ['PUP-ACAD-20261006-7001', 'PUP-ACAD-20261006-7002']);
    assert.equal((await list('?from=2026-10-07')).body.total, 0);
    assert.deepEqual(trackingOf(await list('?q=PUP-ACAD')), ['PUP-ACAD-20261006-7001', 'PUP-ACAD-20261006-7002']);
    for (const bad of ['?office_id=x', '?status=NOPE', '?page_size=101']) assert.equal((await list(bad)).status, 400, bad);
  });

  it('the counter filter is refused (403) and reveals nothing: the counter is not part of the Executive view', async () => {
    const r = await list(`?counter_id=${counterId}`);
    assert.equal(r.status, 403);
    assert.ok(!JSON.stringify(r.body).includes('PUP-OSAS'));
  });
});

describe('CC027 / K14: Executive detail', () => {
  it('opens any office\'s transaction with the same allowlisted view as the list', async () => {
    for (const row of Object.values(rows)) {
      const r = await detail(row.transaction_id);
      assert.equal(r.status, 200, row.tracking_no);
      assertExecutiveShape(r.body, row.tracking_no);
      assertNoPrivateValues(r.body, row.tracking_no);
    }
    const done = await detail(rows.aDone.transaction_id);
    assert.equal(done.body.outcome, 'DISAPPROVED');
    assert.ok(!('disapproval_reason' in done.body));
  });

  it('an unknown or malformed id is still 404, and no token is still 401', async () => {
    assert.equal((await detail(randomUUID())).status, 404);
    assert.equal((await detail('nope')).status, 404);
    assert.equal((await call(detailRoute, req('GET', '/transactions/x'), ctx(rows.aDone.transaction_id))).status, 401);
  });
});

describe('CC027 / K14: every write stays forbidden for the Executive (direct requests)', () => {
  it('Start, Hold, Resume, Complete and Cancel answer 403 and change nothing', async () => {
    const before = await Promise.all(Object.values(rows).map((r) => stateOf(r.transaction_id)));
    const post = (route, path, id, body) => call(route, req('POST', path, { token: tokens.executive, body }), id ? ctx(id) : undefined);
    const attempts = [
      ['start', await post(startRoute, '/transactions', null, { service_id: SERVICE_A, client_type: 'EXTERNAL', requirements_confirmed: true })],
      ['hold', await post(holdRoute, `/transactions/${rows.bOpen.transaction_id}/hold`, rows.bOpen.transaction_id, { reason: 'x' })],
      ['resume', await post(resumeRoute, `/transactions/${rows.aHeld.transaction_id}/resume`, rows.aHeld.transaction_id)],
      ['complete', await post(completeRoute, `/transactions/${rows.bOpen.transaction_id}/complete`, rows.bOpen.transaction_id, { outcome: 'GRANTED' })],
      ['cancel', await post(cancelRoute, `/transactions/${rows.bOpen.transaction_id}/cancel`, rows.bOpen.transaction_id, { reason: 'x' })],
    ];
    for (const [name, r] of attempts) {
      assert.equal(r.status, 403, name);
      assertNoPrivateValues(r.body, name);
    }
    assert.deepEqual(await Promise.all(Object.values(rows).map((r) => stateOf(r.transaction_id))), before, 'nothing changed');
    const [{ n }] = await env.ds.query('SELECT count(*)::int AS n FROM transactions');
    assert.equal(n, 4, 'nothing was started');
  });

  it('the detail and list paths have no write method of their own (other methods are not exported)', async () => {
    const detailModule = await import('../src/app/api/transactions/[id]/route.js');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(detailModule[method], undefined, method);
    const listModule = await import('../src/app/api/transactions/route.js');
    for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal(listModule[method], undefined, method);
  });
});

describe('CC027 / K14: other roles keep their scope and their view', () => {
  it('Super Admin still gets the ordinary detail (private fields included); Office Head and Staff keep their scope', async () => {
    const admin = await detail(rows.aDone.transaction_id, tokens.superAdmin);
    assert.equal(admin.status, 200);
    assert.equal(admin.body.client_email, SECRET.clientEmail);
    assert.equal(admin.body.disapproval_reason, SECRET.disapproval);
    assert.equal(admin.body.started_by_name, SECRET.staffName);
    assert.equal(admin.body.counter_label, SECRET.counterLabel);
    assert.deepEqual(trackingOf(await list('', tokens.officeHeadA)), ['PUP-OSAS-20261006-7001', 'PUP-OSAS-20261006-7002']);
    assert.deepEqual(trackingOf(await list('', tokens.officeStaffA)), ['PUP-OSAS-20261006-7001']);
    assert.equal((await list(`?office_id=${OFFICE_B}`, tokens.officeHeadA)).status, 403);
    assert.equal((await detail(rows.bOpen.transaction_id, tokens.officeHeadA)).status, 403);
    assert.equal((await detail(rows.aHeld.transaction_id, tokens.officeStaffA)).status, 403);
    const headList = (await list('?q=PUP-OSAS-20261006-7001', tokens.officeHeadA)).body.items[0];
    assert.equal(headList.started_by, USERS.staffA, 'the ordinary list item is unchanged for operators');
    assert.equal(headList.counter_label, SECRET.counterLabel);
  });
});

describe('the Executive serializer itself', () => {
  it('is built from the allowlist: an unknown future column never passes through, and absent means absent', () => {
    const row = { ...rows.aDone, office_name: 'Student Affairs', version: 3, future_private_column: 'SYNTH-FUTURE-7Q', client_type: 'ALUMNI' };
    const dto = toExecutiveTransactionDto(row);
    assert.deepEqual(Object.keys(dto).sort(), [...EXECUTIVE_TRANSACTION_FIELDS].sort());
    assert.ok(!JSON.stringify(dto).includes('SYNTH-FUTURE-7Q'));
    assert.ok(!('future_private_column' in dto));
    for (const key of FORBIDDEN_KEYS) assert.ok(!(key in dto), key);
  });

  it('carries no outcome for a row that is not completed, even if one were stored', () => {
    for (const status of ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'AUTO_CLOSED']) {
      assert.equal(toExecutiveTransactionDto({ ...rows.bOpen, status, outcome: 'GRANTED' }).outcome, null, status);
    }
    assert.equal(toExecutiveTransactionDto({ ...rows.aDone, outcome: null }).outcome, null, 'an old completion stays null ("Not recorded")');
  });

  it('the ordinary DTO is unchanged for the other roles (no field was removed from it)', () => {
    const dto = toTransactionDto({ ...rows.aDone, counter_label: SECRET.counterLabel });
    for (const key of ['started_by', 'started_by_name', 'client_email', 'client_reference', 'disapproval_reason', 'counter_label', 'registry_student_number']) {
      assert.ok(key in dto, key);
    }
  });
});
