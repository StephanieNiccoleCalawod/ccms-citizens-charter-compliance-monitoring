// CC040 in Oversight: the optional queue wait through the TT2 store, the KPI figure (average and measured count, null excluded,
// zero included, office/date scoped), compliance figures unchanged, and reports (new figures; older reports still load and export).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ANALYTICS_SCHEMA_VERSION, createDataSource, setDataSource, validateAnalyticsSnapshot } from 'ccms-shared';
import { POST as ingestRoute } from '../src/app/api/analytics-events/route.js';
import { GET as kpiRoute } from '../src/app/api/analytics/kpis/route.js';
import { POST as generateRoute } from '../src/app/api/reports/route.js';
import { GET as oneRoute } from '../src/app/api/reports/[id]/route.js';
import { GET as csvRoute } from '../src/app/api/reports/[id]/export.csv/route.js';
import { entities } from '../src/lib/entities/index.js';
import { computeKpis } from '../src/modules/analytics/kpi.js';
import { reportToCsv } from '../src/modules/reports/csv.js';
import { setNamesProvider } from '../src/modules/reports/names.js';
import { OFFICE_A, OFFICE_B, SERVICE_KEY, USERS, call, req, roleUrl, setupTestEnv, tokens } from './helpers.js';

const SVC = '11111111-1111-4111-8111-111111111111';
let env;
let writer;
before(async () => {
  env = await setupTestEnv();
  writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
  await writer.initialize();
  setNamesProvider(async () => ({ officeName: 'Office A', services: new Map([[SVC, 'Transcript']]) }));
});
after(async () => {
  setNamesProvider(null);
  await writer?.destroy();
  await env?.teardown();
});
beforeEach(async () => {
  await env.ds.query('DELETE FROM reports');
  await env.ds.query('DELETE FROM analytics_transactions');
  setDataSource(writer); // the routes run as the runtime role
});

function snapshot(over = {}) {
  return {
    transaction_id: randomUUID(), tracking_no: `PUP-OSAS-20261015-${String(Math.floor(Math.random() * 8000) + 1).padStart(4, '0')}`, office_id: OFFICE_A,
    service_id: SVC, service_code: 'PUP-OSAS-TOR-001', classification: 'SIMPLE', client_type: 'EMPLOYEE', standard_days: 0, standard_hours: 1, standard_minutes: 0,
    started_at: '2026-10-15T02:00:00.000Z', ended_at: '2026-10-15T02:40:00.000Z', status: 'COMPLETED', elapsed_working_minutes: 40, is_compliant: true,
    variance_minutes: -20, held_minutes: 0, is_backdated: false, started_outside_hours: false, registry_status: 'NONE', registry_miss_reason: null,
    outcome: 'GRANTED', started_by_user_id: USERS.staffA, ended_by_user_id: USERS.staffA, counter_id: null, event_version: 2, ...over,
  };
}
const envelope = (snap) => ({ event_id: randomUUID(), event_type: 'TRANSACTION_COMPLETED', schema_version: ANALYTICS_SCHEMA_VERSION, occurred_at: '2026-10-15T02:40:00.000Z', snapshot: snap });
const post = (snaps) => call(ingestRoute, req('POST', '/analytics-events', { key: SERVICE_KEY, body: { events: snaps.map(envelope) } }));
const waitOf = async (id) => (await env.ds.query('SELECT queue_wait_minutes FROM analytics_transactions WHERE transaction_id = $1', [id]))[0].queue_wait_minutes;

describe('CC040 contract and store', () => {
  it('a snapshot with a wait is stored; an older snapshot without the field, or with null, stores null', async () => {
    const measured = snapshot({ queue_wait_minutes: 14 });
    const zero = snapshot({ queue_wait_minutes: 0 });
    const old = snapshot();
    const explicitNull = snapshot({ queue_wait_minutes: null });
    const r = await post([measured, zero, old, explicitNull]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.applied, 4);
    assert.equal(await waitOf(measured.transaction_id), 14);
    assert.strictEqual(await waitOf(zero.transaction_id), 0);
    assert.equal(await waitOf(old.transaction_id), null);
    assert.equal(await waitOf(explicitNull.transaction_id), null);
    // Normalised copies leave a null optional field out (so a re-sent payload stays readable by an older receiver).
    assert.equal(Object.hasOwn(validateAnalyticsSnapshot(explicitNull), 'queue_wait_minutes'), false);
    assert.equal(validateAnalyticsSnapshot(zero).queue_wait_minutes, 0);
  });

  it('a negative or fractional wait is refused before any write; a replayed older version never overwrites', async () => {
    for (const bad of [-1, 2.5, '3']) {
      const r = await post([snapshot({ queue_wait_minutes: bad })]);
      assert.equal(r.status, 400, String(bad));
    }
    const id = randomUUID();
    assert.equal((await post([snapshot({ transaction_id: id, event_version: 3, queue_wait_minutes: 9 })])).status, 200);
    const replay = await post([snapshot({ transaction_id: id, event_version: 1 })]);
    assert.equal(replay.body.ignored, 1);
    assert.equal(await waitOf(id), 9);
    const [{ n }] = await env.ds.query('SELECT count(*)::int AS n FROM analytics_transactions');
    assert.equal(n, 1);
  });
});

describe('CC040 KPI figure', () => {
  const row = (over) => ({ ...snapshot(over), queue_wait_minutes: over.queue_wait_minutes ?? null });
  const ROWS = [
    row({ queue_wait_minutes: 10 }),
    row({ queue_wait_minutes: 0 }), // a measured zero counts
    row({ queue_wait_minutes: 5, started_at: '2026-10-16T02:00:00.000Z', ended_at: '2026-10-16T02:30:00.000Z' }),
    row({}), // no ticket: left out
    row({ queue_wait_minutes: 100, office_id: OFFICE_B }), // another office
    row({ queue_wait_minutes: 60, started_at: '2026-09-30T02:00:00.000Z', ended_at: '2026-10-02T02:00:00.000Z' }), // started before the period
  ];
  const OCT = { from: '2026-10-01', to: '2026-10-31', now: new Date('2026-11-09T00:00:00Z') };

  it('average minutes and the measured count, under the office and date scope', () => {
    const office = computeKpis(ROWS, { ...OCT, officeId: OFFICE_A }).totals;
    assert.deepEqual(office.queue_wait, { measured: 3, average_minutes: 5 });
    const oneDay = computeKpis(ROWS, { from: '2026-10-16', to: '2026-10-16', officeId: OFFICE_A, now: OCT.now }).totals;
    assert.deepEqual(oneDay.queue_wait, { measured: 1, average_minutes: 5 });
    const none = computeKpis([row({})], { ...OCT, officeId: OFFICE_A }).totals;
    assert.deepEqual(none.queue_wait, { measured: 0, average_minutes: null });
    const campus = computeKpis(ROWS, OCT).totals;
    assert.deepEqual(campus.queue_wait, { measured: 4, average_minutes: 28.8 });
    const byOffice = computeKpis(ROWS, { ...OCT, groupBy: 'office' }).groups.find((g) => g.office_id === OFFICE_B);
    assert.deepEqual(byOffice.queue_wait, { measured: 1, average_minutes: 100 });
  });

  it('AC2: every compliance figure is identical with and without queue waits', () => {
    const strip = (rows) => rows.map(({ queue_wait_minutes: _drop, ...rest }) => rest);
    const withWait = computeKpis(ROWS, { ...OCT, officeId: OFFICE_A, groupBy: 'service' });
    const without = computeKpis(strip(ROWS), { ...OCT, officeId: OFFICE_A, groupBy: 'service' });
    const omitWait = ({ queue_wait: _q, ...rest }) => rest;
    assert.deepEqual(omitWait(withWait.totals), omitWait(without.totals));
    assert.deepEqual(withWait.groups.map(omitWait), without.groups.map(omitWait));
  });

  it('through the KPI route on the database, with the office filter', async () => {
    assert.equal((await post(ROWS.map(({ queue_wait_minutes: q, ...s }) => (q === null ? s : { ...s, queue_wait_minutes: q })))).status, 200);
    const r = await call(kpiRoute, req('GET', `/analytics/kpis?office_id=${OFFICE_A}&period=custom&from=2026-10-01&to=2026-10-31`, { token: tokens.officeHeadA }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.totals.queue_wait, { measured: 3, average_minutes: 5 });
  });
});

describe('CC040 reports', () => {
  it('a new report carries the queue wait figure and its CSV columns; an older report without it still loads and exports', async () => {
    await post([snapshot({ queue_wait_minutes: 8 }), snapshot({ queue_wait_minutes: 2 }), snapshot()]);
    const made = await call(generateRoute, req('POST', '/reports', { token: tokens.officeHeadA, body: { officeId: OFFICE_A, periodType: 'custom', from: '2026-10-01', to: '2026-10-31' } }));
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.deepEqual(made.body.figures.total.queue_wait, { measured: 2, average_minutes: 5 });
    assert.deepEqual(made.body.figures.services[0].queue_wait, { measured: 2, average_minutes: 5 });
    const csv = await (await csvRoute(req('GET', `/reports/${made.body.report_id}/export.csv`, { token: tokens.officeHeadA }), { params: Promise.resolve({ id: made.body.report_id }) })).text();
    const [head, , total] = csv.trim().split('\r\n');
    assert.match(head, /Queue waits measured,Average queue wait \(minutes\)$/);
    assert.match(total, /,2,5$/);

    // A report frozen before CC040: its figures have no queue_wait.
    const oldFigures = JSON.parse(JSON.stringify(made.body.figures));
    delete oldFigures.total.queue_wait;
    for (const s of oldFigures.services) delete s.queue_wait;
    const oldId = randomUUID();
    await env.ds.query(
      `INSERT INTO reports (report_id, office_id, office_name, period_type, period_from, period_to, version, status, figures, generated_by, generated_at)
       VALUES ($1, $2, 'Office A', 'custom', '2026-09-01', '2026-09-30', 1, 'DRAFT', $3::jsonb, $4, now())`,
      [oldId, OFFICE_A, JSON.stringify(oldFigures), USERS.headA],
    );
    const old = await call(oneRoute, req('GET', `/reports/${oldId}`, { token: tokens.officeHeadA }), { params: Promise.resolve({ id: oldId }) });
    assert.equal(old.status, 200, JSON.stringify(old.body));
    assert.equal(old.body.figures.total.queue_wait, undefined);
    const oldCsv = reportToCsv({ ...old.body, from: '2026-09-01', to: '2026-09-30' }).trim().split('\r\n');
    assert.match(oldCsv.at(-1), /,,$/, 'empty queue-wait cells, not zeros');
  });
});
