// Sprint 7 CC029 / CC030 / CC031: generate, publish, correct with a new version, read and export office reports, on a real database
// as the restricted runtime role. Office and service names come from a stand-in for Core.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDataSource, setDataSource } from 'ccms-shared';
import { GET as listRoute, POST as generateRoute } from '../src/app/api/reports/route.js';
import { GET as oneRoute } from '../src/app/api/reports/[id]/route.js';
import { POST as publishRoute } from '../src/app/api/reports/[id]/publish/route.js';
import { POST as versionRoute } from '../src/app/api/reports/[id]/new-version/route.js';
import { GET as csvRoute } from '../src/app/api/reports/[id]/export.csv/route.js';
import { entities } from '../src/lib/entities/index.js';
import { loadKpis } from '../src/modules/analytics/kpi.js';
import { BOM, cell, reportToCsv, usDate } from '../src/modules/reports/csv.js';
import { coreBaseUrl, fetchNames, setNamesProvider } from '../src/modules/reports/names.js';
import { OFFICE_A, OFFICE_B, USERS, call, req, roleUrl, setupTestEnv, tokens } from './helpers.js';

const SVC_1 = '11111111-1111-4111-8111-111111111111';
const SVC_2 = '22222222-2222-4222-8222-222222222222';
const OCT = { periodType: 'custom', from: '2026-10-01', to: '2026-10-31' };
const names = async ({ officeId }) => ({ officeName: officeId === OFFICE_A ? 'Office of Student Affairs' : 'Registrar', services: new Map([[SVC_1, 'Certificate of Good Moral Character'], [SVC_2, 'Número de matrícula (ñ é)']]) });

describe('CSV rules', () => {
  it('formats dates as MM/DD/YYYY and neutralises formulas and quotes', () => {
    assert.equal(usDate('2026-10-05'), '10/05/2026');
    assert.equal(usDate('garbage'), '');
    assert.equal(cell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(cell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(cell(null), '');
    assert.equal(cell(12.5), '12.5');
  });
  it('starts with a byte-order mark and ends with a total row', () => {
    const csv = reportToCsv({ office_name: 'Ñandú', period_type: 'custom', from: '2026-10-01', to: '2026-10-31', version: 2, status: 'PUBLISHED', figures: { services: [{ service_name: 'A', received: 3, results: { on_time: 1, late_total: 1, late_auto_closed: 0, on_time_rate: 50 }, pending: { count: 1 } }], total: { received: 3, results: { on_time_rate: 50 }, pending: { count: 1 } } } });
    assert.ok(csv.startsWith(BOM));
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^Ñandú,Custom,10\/01\/2026,10\/31\/2026,2,Published,A,3,1,1,0,50,/);
    assert.match(lines[2], /Total \(all services\)/);
  });
});

describe('names from Core', () => {
  it('accepts the base address with or without /api and fails closed', async () => {
    assert.equal(coreBaseUrl({ CORE_URL: 'http://core:3003/' }), 'http://core:3003/api');
    assert.equal(coreBaseUrl({ CORE_URL: 'http://core:3003/api' }), 'http://core:3003/api');
    assert.equal(coreBaseUrl({}), null);
    await assert.rejects(fetchNames({ officeId: OFFICE_A, authorization: 'Bearer x', env: {} }), (e) => e.status === 503 && e.code === 'CORE_UNAVAILABLE');
    await assert.rejects(fetchNames({ officeId: OFFICE_A, authorization: 'Bearer x', env: { CORE_URL: 'http://core' }, fetchImpl: async () => ({ ok: false, status: 500 }) }), (e) => e.status === 503);
  });
  it('keeps only the office’s own services and forwards the caller’s token', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(init.headers.authorization);
      const body = url.endsWith('/offices') ? { items: [{ office_id: OFFICE_A, office_name: 'OSA' }] }
        : { items: [{ service_id: SVC_1, service_name: 'Mine', office_id: OFFICE_A }, { service_id: SVC_2, service_name: 'Theirs', office_id: OFFICE_B }], total: 2 };
      return { ok: true, json: async () => body };
    };
    const out = await fetchNames({ officeId: OFFICE_A, authorization: 'Bearer abc', env: { CORE_URL: 'http://core' }, fetchImpl });
    assert.equal(out.officeName, 'OSA');
    assert.deepEqual([...out.services], [[SVC_1, 'Mine']]);
    assert.ok(seen.every((a) => a === 'Bearer abc'));
  });
});

describe('Reports through the routes (real database, runtime role)', () => {
  let env;
  let writer;
  before(async () => {
    env = await setupTestEnv();
    writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
    await writer.initialize();
    setNamesProvider(names);
  });
  after(async () => {
    setNamesProvider(null);
    await writer?.destroy();
    await env?.teardown();
  });
  beforeEach(async () => {
    await env.ds.query('DELETE FROM reports');
    await env.ds.query('DELETE FROM analytics_transactions');
    await env.ds.query(`DELETE FROM audit_log WHERE action = 'REPORT_PUBLISHED'`);
    setDataSource(writer);
  });

  async function tx(over = {}) {
    const r = { office_id: OFFICE_A, service_id: SVC_1, started_at: '2026-10-05T01:00:00Z', ended_at: '2026-10-05T02:00:00Z', status: 'COMPLETED', elapsed: 30, variance: -10, compliant: true, ...over };
    await env.ds.query(
      `INSERT INTO analytics_transactions (transaction_id, tracking_no, office_id, service_id, service_code, classification, client_type, standard_days, standard_hours, standard_minutes,
         started_at, ended_at, status, elapsed_working_minutes, is_compliant, variance_minutes, held_minutes, is_backdated, started_outside_hours, registry_status, started_by_user_id, event_version, is_seeded)
       VALUES ($1,$2,$3,$4,'X','SIMPLE','STUDENT',0,1,0,$5,$6,$7,$8,$9,$10,0,false,false,'NONE',$11,1,false)`,
      [randomUUID(), `T-${randomUUID().slice(0, 8)}`, r.office_id, r.service_id, r.started_at, r.ended_at, r.status, r.elapsed, r.compliant, r.variance, USERS.staffA],
    );
  }
  const seed = async () => {
    await tx(); // on time
    await tx({ service_id: SVC_2, elapsed: 90, variance: 30, compliant: false }); // late
    await tx({ status: 'CANCELLED', ended_at: null, elapsed: null, variance: null, compliant: null });
    await tx({ status: 'AUTO_CLOSED', ended_at: null, elapsed: null, variance: null, compliant: null });
    await tx({ status: 'IN_PROGRESS', ended_at: null, elapsed: null, variance: null, compliant: null });
    await tx({ office_id: OFFICE_B }); // another office, never in office A's report
  };
  const generate = (token, body = { officeId: OFFICE_A, ...OCT }) => call(generateRoute, req('POST', '/reports', { token, body }));
  const list = (token, query = '') => call(listRoute, req('GET', `/reports${query}`, { token }));
  const one = (token, id) => call(oneRoute, req('GET', `/reports/${id}`, { token }), { params: { id } });
  const publish = (token, id, body = { confirm: true }) => call(publishRoute, req('POST', `/reports/${id}/publish`, { token, body }), { params: { id } });
  const newVersion = (token, id, body) => call(versionRoute, req('POST', `/reports/${id}/new-version`, { token, body }), { params: { id } });

  it('AC1/AC2: the draft equals the KPI module, per service and in total, with cancelled/auto-closed/pending as their own lines', async () => {
    await seed();
    const made = await generate(tokens.officeHeadA);
    assert.equal(made.status, 200);
    assert.equal(made.body.status, 'DRAFT');
    assert.equal(made.body.version, 1);
    assert.equal(made.body.office_name, 'Office of Student Affairs');
    const period = { from: '2026-10-01', to: '2026-10-31' };
    const total = await loadKpis(env.ds, { officeId: OFFICE_A, groupBy: 'total', period, now: new Date(made.body.generated_at) });
    assert.deepEqual(made.body.figures.total, total.totals);
    const t = made.body.figures.total;
    assert.equal(t.cancelled, 1);
    assert.equal(t.auto_closed, 1);
    assert.equal(t.pending.count, 1);
    assert.equal(t.results.on_time, 1);
    assert.equal(t.results.late_total, 2); // one late and one auto-closed (K27)
    assert.equal(t.results.on_time_rate, 33.3);
    const services = made.body.figures.services;
    assert.deepEqual(services.map((s) => s.service_name).sort(), ['Certificate of Good Moral Character', 'Número de matrícula (ñ é)'].sort());
    assert.equal(services.reduce((n, s) => n + s.received, 0), t.received);
  });

  it('AC3: every period type works and half-year is the default', async () => {
    for (const periodType of ['weekly', 'monthly', 'annual']) {
      const r = await generate(tokens.officeHeadA, { officeId: OFFICE_A, periodType, date: '2026-10-15' });
      assert.equal(r.status, 200, periodType);
      assert.equal(r.body.period_type, periodType);
    }
    const def = await generate(tokens.officeHeadA, { officeId: OFFICE_A, date: '2026-10-15' });
    assert.equal(def.body.period_type, 'half_year');
    assert.equal(def.body.from, '2026-07-01');
    assert.equal(def.body.to, '2026-12-31');
    assert.equal((await generate(tokens.officeHeadA, { officeId: OFFICE_A, periodType: 'custom', from: '2026-10-09', to: '2026-10-01' })).status, 400);
    assert.equal((await generate(tokens.officeHeadA, { officeId: OFFICE_A, periodType: 'daily' })).status, 400);
    assert.equal((await generate(tokens.officeHeadA, { officeId: 'nope' })).status, 400);
  });

  it('generating again refreshes the same draft (any number of times)', async () => {
    const first = await generate(tokens.officeHeadA);
    await seed();
    const second = await generate(tokens.officeHeadA);
    assert.equal(second.body.report_id, first.body.report_id);
    assert.equal(second.body.figures.total.received, 5);
    assert.equal((await env.ds.query(`SELECT count(*)::int AS n FROM reports`))[0].n, 1);
  });

  it('AC6: roles and offices', async () => {
    assert.equal((await generate(tokens.officeHeadB, { officeId: OFFICE_A, ...OCT })).status, 403);
    assert.equal((await generate(tokens.officeStaffA)).status, 403);
    assert.equal((await generate(tokens.executive)).status, 403);
    assert.equal((await generate(tokens.superAdmin, { officeId: OFFICE_B, ...OCT })).status, 200);
    assert.equal((await generate(null)).status, 401);
  });

  it('CC030: publish needs the confirmation, freezes the figures, is audited, and a second publish is refused', async () => {
    await seed();
    const draft = (await generate(tokens.officeHeadA)).body;
    assert.equal((await publish(tokens.officeHeadA, draft.report_id, {})).status, 400);
    assert.equal((await publish(tokens.officeHeadB, draft.report_id)).status, 403);
    const done = await publish(tokens.officeHeadA, draft.report_id);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'PUBLISHED');
    assert.equal(done.body.published_by, USERS.headA);
    assert.ok(done.body.published_at);
    assert.deepEqual(done.body.figures, draft.figures);
    // Later transactions and a repeated publish change nothing.
    await tx({ started_at: '2026-10-20T01:00:00Z', ended_at: '2026-10-20T02:00:00Z' });
    await tx({ status: 'CANCELLED', ended_at: null, elapsed: null, variance: null, compliant: null });
    assert.deepEqual((await one(tokens.officeHeadA, draft.report_id)).body.figures, draft.figures);
    const again = await publish(tokens.officeHeadA, draft.report_id);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'REPORT_NOT_A_DRAFT');
    const regen = await generate(tokens.officeHeadA);
    assert.equal(regen.status, 409);
    assert.equal(regen.body.error.code, 'REPORT_ALREADY_PUBLISHED');
    const audit = await env.ds.query(`SELECT actor_user_id, actor_role, entity_type, entity_id, office_id, after_value FROM audit_log WHERE action = 'REPORT_PUBLISHED'`);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_user_id, USERS.headA);
    assert.equal(audit[0].entity_id, draft.report_id);
    assert.equal(audit[0].after_value.version, 1);
  });

  it('CC030: the Super Admin may publish any office, and it is logged as theirs', async () => {
    const draft = (await generate(tokens.superAdmin, { officeId: OFFICE_B, ...OCT })).body;
    assert.equal((await publish(tokens.superAdmin, draft.report_id)).status, 200);
    const [a] = await env.ds.query(`SELECT actor_user_id, actor_role FROM audit_log WHERE action = 'REPORT_PUBLISHED'`);
    assert.equal(a.actor_user_id, USERS.adminId);
    assert.equal(a.actor_role, 'super_admin');
  });

  it('CC030 AC3: version 2 needs a reason; publishing it supersedes version 1, which stays readable', async () => {
    const v1 = (await generate(tokens.officeHeadA)).body;
    assert.equal((await newVersion(tokens.officeHeadA, v1.report_id, { reason: 'x' })).status, 409); // v1 is still a draft
    await publish(tokens.officeHeadA, v1.report_id);
    assert.equal((await newVersion(tokens.officeHeadA, v1.report_id, {})).status, 400);
    assert.equal((await newVersion(tokens.officeHeadA, v1.report_id, { reason: '   ' })).status, 400);
    assert.equal((await newVersion(tokens.officeHeadB, v1.report_id, { reason: 'Because' })).status, 403);
    await tx({ started_at: '2026-10-20T01:00:00Z', ended_at: '2026-10-20T02:00:00Z' });
    const v2 = await newVersion(tokens.officeHeadA, v1.report_id, { reason: 'A late entry was corrected' });
    assert.equal(v2.status, 201);
    assert.equal(v2.body.version, 2);
    assert.equal(v2.body.status, 'DRAFT');
    assert.equal(v2.body.supersede_reason, 'A late entry was corrected');
    assert.equal(v2.body.supersedes_report_id, v1.report_id);
    assert.equal(v2.body.figures.total.received, 1);
    assert.equal((await newVersion(tokens.officeHeadA, v1.report_id, { reason: 'again' })).status, 409); // a draft already exists
    // While v2 is a draft, v1 is still the published one.
    assert.equal((await one(tokens.officeHeadA, v1.report_id)).body.status, 'PUBLISHED');
    assert.equal((await publish(tokens.officeHeadA, v2.body.report_id)).status, 200);
    const old = (await one(tokens.officeHeadA, v1.report_id)).body;
    assert.equal(old.status, 'SUPERSEDED');
    assert.equal(old.replaced_by_version, 2);
    assert.equal(old.replaced_by_report_id, v2.body.report_id);
    assert.deepEqual(old.figures, v1.figures);
    const audit = await env.ds.query(`SELECT after_value FROM audit_log WHERE action = 'REPORT_PUBLISHED' ORDER BY occurred_at`);
    assert.equal(audit.length, 2);
    assert.equal(audit.at(-1).after_value.reason, 'A late entry was corrected');
  });

  it('CC031: who reads what', async () => {
    const a = (await generate(tokens.officeHeadA)).body;
    const b = (await generate(tokens.superAdmin, { officeId: OFFICE_B, ...OCT })).body;
    await publish(tokens.officeHeadA, a.report_id);
    // Executive: published only, every office, no names of people.
    assert.deepEqual((await list(tokens.executive)).body.items.map((r) => r.report_id), [a.report_id]);
    const seen = (await one(tokens.executive, a.report_id)).body;
    assert.equal(seen.status, 'PUBLISHED');
    assert.ok(!('published_by' in seen) && !('published_by_name' in seen));
    assert.equal((await one(tokens.executive, b.report_id)).status, 404); // a draft does not exist for them
    await publish(tokens.superAdmin, b.report_id);
    assert.equal((await list(tokens.executive)).body.total, 2);
    // Office Head: own office only (drafts too), another office is hidden or refused.
    const c = (await generate(tokens.officeHeadA, { officeId: OFFICE_A, periodType: 'monthly', date: '2026-09-10' })).body;
    assert.deepEqual((await list(tokens.officeHeadA)).body.items.map((r) => r.office_id).filter((v, i, all) => all.indexOf(v) === i), [OFFICE_A]);
    assert.equal((await list(tokens.officeHeadA)).body.items.some((r) => r.report_id === c.report_id && r.status === 'DRAFT'), true);
    assert.equal((await one(tokens.officeHeadA, b.report_id)).status, 404);
    assert.equal((await list(tokens.officeHeadA, `?office_id=${OFFICE_B}`)).status, 403);
    // Office Staff: 403 (switch off). Unknown id: 404.
    assert.equal((await list(tokens.officeStaffA)).status, 403);
    assert.equal((await one(tokens.officeStaffA, a.report_id)).status, 403);
    assert.equal((await one(tokens.superAdmin, randomUUID())).status, 404);
    // Filters and paging.
    assert.equal((await list(tokens.superAdmin, '?status=PUBLISHED&period_type=custom')).body.total, 2);
    assert.equal((await list(tokens.superAdmin, '?page_size=1')).body.items.length, 1);
    assert.equal((await list(tokens.superAdmin, '?status=bogus')).status, 400);
  });

  it('CC031: a report holds no per-staff figures', async () => {
    await seed();
    const draft = (await generate(tokens.officeHeadA)).body;
    assert.doesNotMatch(JSON.stringify(draft.figures), new RegExp(USERS.staffA));
    assert.ok(!JSON.stringify(draft.figures).includes('user_id'));
  });

  it('AC4: the CSV has a BOM, accents, MM/DD/YYYY and the same numbers', async () => {
    await seed();
    const draft = (await generate(tokens.officeHeadA)).body;
    const response = await csvRoute(req('GET', `/reports/${draft.report_id}/export.csv`, { token: tokens.officeHeadA }), { params: Promise.resolve({ id: draft.report_id }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv; charset=utf-8/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    assert.match(text, /Número de matrícula \(ñ é\)/);
    assert.match(text, /10\/01\/2026,10\/31\/2026/);
    const lines = text.replace(BOM, '').trim().split('\r\n');
    assert.equal(lines.length, 1 + 2 + 1); // header, two services, total
    const total = lines.at(-1).split(',');
    assert.equal(total[7], String(draft.figures.total.received));
    assert.equal(total[11], String(draft.figures.total.results.on_time_rate));
    const stranger = await csvRoute(req('GET', `/reports/${draft.report_id}/export.csv`, { token: tokens.officeHeadB }), { params: Promise.resolve({ id: draft.report_id }) });
    assert.equal(stranger.status, 404);
  });

  it('Core down: nothing is saved', async () => {
    setNamesProvider(async () => { const { AppError } = await import('ccms-shared'); throw new AppError(503, 'CORE_UNAVAILABLE', 'down'); });
    try {
      assert.equal((await generate(tokens.officeHeadA)).status, 503);
      assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM reports'))[0].n, 0);
    } finally {
      setNamesProvider(names);
    }
  });

  it('the database refuses what the service never does (CHECKs, one published, no DELETE for the runtime roles)', async () => {
    const draft = (await generate(tokens.officeHeadA)).body;
    await publish(tokens.officeHeadA, draft.report_id);
    const writerUrl = roleUrl(env.url, 'ccms_logs_writer');
    const readerUrl = roleUrl(env.url, 'ccms_oversight_app');
    const as = async (url, sql, params = []) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try { await c.query('BEGIN'); return await c.query(sql, params); } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
    };
    await assert.rejects(as(writerUrl, 'DELETE FROM reports'), (e) => e.code === '42501');
    await assert.rejects(as(readerUrl, `UPDATE reports SET status = 'DRAFT'`), (e) => e.code === '42501');
    assert.equal((await as(readerUrl, 'SELECT count(*)::int AS n FROM reports')).rows[0].n, 1);
    // Two published reports for one office and period cannot exist.
    await assert.rejects(
      as(writerUrl, `INSERT INTO reports (report_id, office_id, period_type, period_from, period_to, version, status, figures, generated_by, published_by, published_at)
        VALUES (gen_random_uuid(), $1, 'custom', '2026-10-01', '2026-10-31', 9, 'PUBLISHED', '{}', $2, $2, now())`, [OFFICE_A, USERS.headA]),
      (e) => e.code === '23505',
    );
    // A published report must say who published it; a draft must not carry a publish time.
    await assert.rejects(as(writerUrl, `UPDATE reports SET published_by = NULL`), (e) => e.code === '23514');
    await assert.rejects(as(writerUrl, `UPDATE reports SET status = 'LIVE'`), (e) => e.code === '23514');
  });
});
