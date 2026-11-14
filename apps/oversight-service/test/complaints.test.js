// Sprint 6 CC032 / CC033: file a complaint without an account and check its status, on a real database as the runtime role.
// Core (office check) and the mailer are stand-ins.
import { strict as assert } from 'node:assert';
import pg from 'pg';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDataSource, createRateLimiter, setDataSource } from 'ccms-shared';
import { createMemoryStore } from 'ccms-shared';
import { POST as fileRoute } from '../src/app/api/complaints/route.js';
import { GET as statusRoute } from '../src/app/api/complaints/status/route.js';
import { entities } from '../src/lib/entities/index.js';
import { CATEGORY_VALUES, fileComplaint, isReference, limitRequest, makeReference, officeIsActive, setLimiters, validateComplaint } from '../src/modules/complaints/complaints.js';
import { OFFICE_A, call, req, roleUrl, setupTestEnv } from './helpers.js';

const good = (over = {}) => ({ office_id: OFFICE_A, category: 'DELAYED_SERVICE', description: 'Waited three weeks for a certificate.', ...over });
const active = async () => true;

describe('validation and references', () => {
  it('reports every bad field together', () => {
    assert.throws(() => validateComplaint({}), (e) => e.status === 400 && 'office_id' in e.details && 'category' in e.details && 'description' in e.details);
    assert.throws(() => validateComplaint(good({ description: 'x'.repeat(2001) })), (e) => /2000/.test(e.details.description));
    assert.throws(() => validateComplaint(good({ email: 'not-an-email' })), (e) => 'email' in e.details);
    assert.throws(() => validateComplaint(good({ name: 'n'.repeat(201) })), (e) => 'name' in e.details);
    assert.throws(() => validateComplaint(good({ category: 'MADE_UP' })), (e) => 'category' in e.details);
    assert.throws(() => validateComplaint(good({ description: 'bad\u0000text' })), (e) => 'description' in e.details);
  });
  it('accepts the optional fields as empty and trims text', () => {
    const v = validateComplaint(good({ tracking_no: '', name: '  ', email: 'Ana@Example.COM ', description: '  hello  ' }));
    assert.equal(v.trackingNo, null);
    assert.equal(v.name, null);
    assert.equal(v.email, 'ana@example.com');
    assert.equal(v.description, 'hello');
  });
  it('makes references that look right and are not guessable by shape alone', () => {
    const refs = new Set(Array.from({ length: 200 }, () => makeReference(new Date('2026-11-13T00:00:00Z'))));
    assert.equal(refs.size, 200);
    for (const r of refs) { assert.match(r, /^CMP-20261113-[A-Z2-9]{6}$/); assert.ok(isReference(r)); }
    assert.equal(isReference("x'; DROP TABLE complaints;--"), false);
    assert.ok(CATEGORY_VALUES.includes('OTHER'));
  });
  it('asks Core with the service key and fails closed when Core is down or unconfigured', async () => {
    const env = { CORE_URL: 'http://core', SERVICE_KEY: 'k' };
    let seen;
    const ok = async (url, init) => { seen = { url, key: init.headers['x-service-key'] }; return { ok: true, status: 200, json: async () => ({ office: { is_active: true } }) }; };
    assert.equal(await officeIsActive(OFFICE_A, { env, fetchImpl: ok }), true);
    assert.equal(seen.url, `http://core/api/offices/${OFFICE_A}`);
    assert.equal(seen.key, 'k');
    assert.equal(await officeIsActive(OFFICE_A, { env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ office: { is_active: false } }) }) }), false);
    assert.equal(await officeIsActive(OFFICE_A, { env, fetchImpl: async () => ({ ok: false, status: 404 }) }), false);
    await assert.rejects(officeIsActive(OFFICE_A, { env, fetchImpl: async () => ({ ok: false, status: 500 }) }), (e) => e.status === 503);
    await assert.rejects(officeIsActive(OFFICE_A, { env, fetchImpl: async () => { throw new Error('down'); } }), (e) => e.status === 503);
    await assert.rejects(officeIsActive(OFFICE_A, { env: {} }), (e) => e.status === 503);
  });
});

describe('Complaints through the routes (real database, runtime role)', () => {
  let env;
  let writer;
  before(async () => {
    env = await setupTestEnv();
    writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
    await writer.initialize();
  });
  after(async () => { setLimiters(null); await writer?.destroy(); await env?.teardown(); });
  beforeEach(async () => {
    await env.ds.query('DELETE FROM complaints');
    setDataSource(writer);
    setLimiters({ file: createRateLimiter({ store: createMemoryStore() }), status: createRateLimiter({ store: createMemoryStore() }) });
    process.env.CORE_URL = 'http://core.test';
    process.env.SERVICE_KEY = 'test-service-key-0123456789';
  });

  const withCore = async (isActive, task) => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ office: { is_active: isActive } }) });
    try { return await task(); } finally { globalThis.fetch = real; }
  };
  const file = (body, headers = {}) => withCore(true, () => call(fileRoute, req('POST', '/complaints', { body, headers })));
  const status = (ref, headers = {}) => call(statusRoute, req('GET', `/complaints/status?ref=${encodeURIComponent(ref)}`, { headers }));

  it('AC1/AC3: no account needed; a reference comes back and the row is stored', async () => {
    const r = await file(good({ name: 'Ana', tracking_no: 'OSA-20261105-0001' }));
    assert.equal(r.status, 201);
    assert.match(r.body.reference, /^CMP-\d{8}-[A-Z2-9]{6}$/);
    assert.equal(r.body.status, 'RECEIVED');
    assert.equal(r.body.email_sent, null);
    const [row] = await env.ds.query('SELECT * FROM complaints');
    assert.equal(row.reference, r.body.reference);
    assert.equal(row.office_id, OFFICE_A);
    assert.equal(row.complainant_name, 'Ana');
    assert.equal(row.status, 'RECEIVED');
  });

  it('AC1: office, category and description are required (400, nothing stored)', async () => {
    for (const bad of [good({ office_id: undefined }), good({ category: undefined }), good({ description: '' })]) {
      assert.equal((await file(bad)).status, 400);
    }
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM complaints'))[0].n, 0);
  });

  it('AC2: an inactive office is refused', async () => {
    const r = await withCore(false, () => call(fileRoute, req('POST', '/complaints', { body: good() })));
    assert.equal(r.status, 400);
    assert.ok(r.body.error.details.office_id);
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM complaints'))[0].n, 0);
  });

  it('AC3: the reference is emailed when an email was given, and a mail failure does not lose the complaint', async () => {
    const sent = [];
    const mailer = { configured: true, send: async (m) => { sent.push(m); } };
    const out = await fileComplaint(writer, good({ email: 'ana@example.com' }), { isActiveOffice: active, mailer });
    assert.equal(out.email_sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ana@example.com');
    assert.ok(sent[0].text.includes(out.reference));
    const failing = { configured: true, send: async () => { throw new Error('smtp down'); } };
    const out2 = await fileComplaint(writer, good({ email: 'ana@example.com' }), { isActiveOffice: active, mailer: failing });
    assert.equal(out2.email_sent, false);
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM complaints'))[0].n, 2);
    const unconfigured = await fileComplaint(writer, good({ email: 'ana@example.com' }), { isActiveOffice: active, mailer: { configured: false, send: async () => { throw new Error('never'); } } });
    assert.equal(unconfigured.email_sent, false);
  });

  it('AC4: too many requests return 429 with Retry-After', async () => {
    setLimiters({ file: createRateLimiter({ store: createMemoryStore() }), status: createRateLimiter({ store: createMemoryStore() }) });
    process.env.COMPLAINT_RATE_LIMIT = '2';
    try {
      const h = { 'x-forwarded-for': '203.0.113.9' };
      assert.equal((await file(good(), h)).status, 201);
      assert.equal((await file(good(), h)).status, 201);
      const third = await file(good(), h);
      assert.equal(third.status, 429);
      assert.ok(Number(third.headers.get('retry-after')) >= 1);
      assert.equal((await file(good(), { 'x-forwarded-for': '203.0.113.10' })).status, 201); // another address is not affected
    } finally { delete process.env.COMPLAINT_RATE_LIMIT; }
  });

  it('CC033 AC1/AC2: a reference shows only its status; an unknown or malformed one shows nothing', async () => {
    const made = (await file(good({ name: 'Secret Name', email: 'a@b.co' }))).body;
    const ok = await status(made.reference.toLowerCase());
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { reference: made.reference, status: 'RECEIVED' });
    const unknown = await status('CMP-20261113-ABCDEF');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'COMPLAINT_NOT_FOUND');
    const malformed = await status("' OR 1=1 --");
    assert.equal(malformed.status, 404);
    assert.deepEqual(Object.keys(malformed.body.error).sort(), Object.keys(unknown.body.error).sort());
    assert.equal((await status('')).status, 404);
  });

  it('CC033 AC3: the status route is rate limited', async () => {
    const tiny = createRateLimiter({ store: createMemoryStore() });
    setLimiters({ file: null, status: tiny });
    process.env.PUBLIC_RATE_LIMIT = '2';
    try {
      const h = { 'x-forwarded-for': '198.51.100.4' };
      assert.equal((await status('CMP-20261113-ABCDEF', h)).status, 404);
      assert.equal((await status('CMP-20261113-ABCDEF', h)).status, 404);
      assert.equal((await status('CMP-20261113-ABCDEF', h)).status, 429);
    } finally { delete process.env.PUBLIC_RATE_LIMIT; }
  });

  it('the shared database limiter works with the rate_limit_hits grants', async () => {
    setLimiters(null);
    const r = await limitRequest(new Request('http://x/api/complaints', { headers: { 'x-forwarded-for': '192.0.2.77' } }), 'cid', 'status');
    assert.equal(r, null);
    assert.equal((await env.ds.query(`SELECT count(*)::int AS n FROM rate_limit_hits WHERE key LIKE 'complaints:status:192.0.2.77'`))[0].n, 1);
  });

  it('the database gives the runtime roles only what they need', async () => {
    const as = async (url, sql, params = []) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try { await c.query('BEGIN'); return await c.query(sql, params); } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
    };
    const w = roleUrl(env.url, 'ccms_logs_writer');
    const r = roleUrl(env.url, 'ccms_oversight_app');
    await assert.rejects(as(w, 'DELETE FROM complaints'), (e) => e.code === '42501');
    // CC034: staff handling updates complaints, but the status rules are enforced by the database (a check constraint), and nothing is deleted.
    const row = (await env.ds.query(`INSERT INTO complaints (complaint_id, reference, office_id, category, description, status) VALUES (gen_random_uuid(), 'CMP-20261113-GRANTS', gen_random_uuid(), 'OTHER', 'x', 'RECEIVED') RETURNING complaint_id`))[0];
    await assert.rejects(as(w, `UPDATE complaints SET status = 'X' WHERE complaint_id = $1`, [row.complaint_id]), (e) => e.code === '23514');
    await assert.rejects(as(w, `UPDATE complaints SET status = 'RESOLVED', resolved_at = now() WHERE complaint_id = $1`, [row.complaint_id]), (e) => e.code === '23514'); // no reply, and not acknowledged
    await env.ds.query('DELETE FROM complaints WHERE complaint_id = $1', [row.complaint_id]);
    await assert.rejects(as(r, 'SELECT 1 FROM rate_limit_hits'), (e) => e.code === '42501');
    await assert.rejects(as(r, `INSERT INTO complaints (complaint_id, reference, office_id, category, description, status) VALUES (gen_random_uuid(), 'CMP-20261113-AAAAAA', gen_random_uuid(), 'OTHER', 'x', 'RECEIVED')`), (e) => e.code === '42501');
    assert.equal((await as(r, 'SELECT count(*)::int AS n FROM complaints')).rows[0].n, 0);
  });

  it('a complaint stays out of the audit log (no names or emails there)', async () => {
    const before = (await env.ds.query('SELECT count(*)::int AS n FROM audit_log'))[0].n;
    await file(good({ name: 'Ana', email: 'ana@example.com' }));
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM audit_log'))[0].n, before);
  });
});
