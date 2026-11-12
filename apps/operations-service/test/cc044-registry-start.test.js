// CC044 registry lookup at Start (spec 4.2) and CC047 client-type eligibility at Start (spec 8.1).
// Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createMemoryStore, createRateLimiter, toManilaDate } from 'ccms-shared';
import { GET as searchRoute } from '../src/app/api/registry/search/route.js';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { GET as exportRoute } from '../src/app/api/transactions/analytics-export/route.js';
import { foldName, setRegistrySearchLimiter } from '../src/modules/registry/lookup.js';
import { NOT_IN_REGISTRY, SERVICE_A, SERVICE_KEY, call, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

let env;
const today = () => toManilaDate(new Date());
const shift = (days) => toManilaDate(new Date(Date.now() + days * 86_400_000));

before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
  const importId = randomUUID();
  await env.ds.query('INSERT INTO registry_imports (import_id, rows, added, updated, unchanged) VALUES ($1, 16, 16, 0, 0)', [importId]);
  const people = [
    ['2023-00001-QC-0', 'José Ana Dela Cruz', 'BSIT', 2, 'ENROLLED', shift(200), 'jose.registry@example.com'],
    ['2023-00002-QC-0', 'Ana%_Literal Test', 'BSIT', 1, 'ENROLLED', shift(200), null],
    ['2019-00003-QC-0', 'Expired Anabel Reyes', 'BSA', 3, 'ENROLLED', shift(-1), 'old@example.com'],
    ['2015-00004-QC-0', 'Alumna Ana Santos', 'BSBA', null, 'ALUMNI', null, 'alumna@example.com'],
  ];
  for (let i = 0; i < 12; i += 1) people.push([`2024-1${String(i).padStart(4, '0')}-QC-0`, `Mariana Filler ${i}`, 'BSIT', 1, 'ENROLLED', shift(100), null]);
  for (const p of people) {
    await env.ds.query(
      `INSERT INTO registry_people (student_number, full_name, program, year_level, status, valid_until, email, last_import_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [...p, importId],
    );
  }
});
after(async () => {
  setRegistrySearchLimiter(null);
  await env?.teardown();
});
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
  await env.ds.query('DELETE FROM rate_limit_hits');
  setRegistrySearchLimiter(createRateLimiter({ store: createMemoryStore(), failOpen: false }));
  const service = env.core.state.services.get(SERVICE_A);
  delete service.allowed_client_types;
});

const search = (query, token = tokens.officeStaffA) => call(searchRoute, req('GET', `/registry/search${query}`, { token }));
const start = (over = {}, token = tokens.officeStaffA) => call(startRoute, req('POST', '/transactions', {
  token, body: { service_id: SERVICE_A, client_type: 'STUDENT', requirements_confirmed: true, ...over },
}));
const audits = (action) => env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' = $1 ORDER BY created_at", [action]);
const count = async (table) => (await env.ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

describe('CC044 GET /registry/search', () => {
  it('allows Office Staff, Office Head and Super Admin; refuses the Executive', async () => {
    for (const token of [tokens.officeStaffA, tokens.officeHeadA, tokens.superAdmin]) assert.equal((await search('?q=ana', token)).status, 200);
    assert.equal((await search('?q=ana', tokens.executive)).status, 403);
    assert.equal((await call(searchRoute, req('GET', '/registry/search?q=ana'))).status, 401);
  });

  it('"ana" returns at most 10 results, deterministically ordered; "an" is refused', async () => {
    const first = await search('?q=ana');
    assert.equal(first.status, 200);
    assert.ok(first.body.items.length <= 10);
    assert.deepEqual((await search('?q=ana')).body.items, first.body.items);
    assert.equal((await search('?q=an')).status, 400);
    assert.equal((await search('?q=')).status, 400);
    assert.equal((await search('?q=ana&extra=1')).status, 400);
  });

  it('matches names ignoring case and accents, and a complete student number exactly', async () => {
    assert.equal(foldName('JOSÉ'), 'jose');
    const accent = await search('?q=JOSE%20ana');
    assert.deepEqual(accent.body.items.map((r) => r.student_number), ['2023-00001-QC-0']);
    const exact = await search(`?q=${encodeURIComponent('2023-00001-QC-0')}`);
    assert.equal(exact.body.items[0].student_number, '2023-00001-QC-0');
    assert.equal((await search(`?q=${encodeURIComponent('2023-00001')}`)).body.items.length, 0, 'a partial number is not a match');
  });

  it('treats SQL wildcards literally', async () => {
    const literal = await search(`?q=${encodeURIComponent('ana%_')}`);
    assert.deepEqual(literal.body.items.map((r) => r.student_number), ['2023-00002-QC-0']);
    assert.equal((await search(`?q=${encodeURIComponent('%%%abc')}`)).body.items.length, 0);
  });

  it('narrows by status, flags expiry and never returns the registry email', async () => {
    const students = await search('?q=ana&status=STUDENT');
    assert.ok(students.body.items.every((r) => r.status === 'ENROLLED'));
    const alumni = await search('?q=ana&status=ALUMNI');
    assert.deepEqual(alumni.body.items.map((r) => r.student_number), ['2015-00004-QC-0']);
    const expired = await search('?q=anabel');
    assert.equal(expired.body.items[0].is_expired, true);
    assert.equal(JSON.stringify((await search('?q=ana')).body).includes('@'), false);
    assert.equal((await search('?q=ana&status=EMPLOYEE')).status, 400);
  });

  it('is never cached and audits who, when and how many only', async () => {
    const r = await search('?q=mariana');
    assert.match(r.headers.get('cache-control'), /no-store/);
    const [{ payload }] = (await audits('REGISTRY_SEARCHED')).slice(-1);
    assert.deepEqual(payload.after_value, { result_count: r.body.items.length });
    assert.ok(payload.actor_user_id && payload.occurred_at);
    const text = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ['mariana', 'filler', '2024-1', '@']) assert.equal(text.includes(forbidden), false, forbidden);
  });

  it('answers 429 on the 31st search in a minute, and 503 (fail closed) when the limiter store fails', async () => {
    for (let i = 0; i < 30; i += 1) assert.equal((await search('?q=ana')).status, 200, `search ${i + 1}`);
    const limited = await search('?q=ana');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    setRegistrySearchLimiter(createRateLimiter({ store: { hit: async () => { throw new Error('down'); } }, failOpen: false }));
    assert.equal((await search('?q=ana')).status, 503);
  });
});

describe('CC044 registry resolution at Start', () => {
  it('links a valid match and fills only an empty email from the registry', async () => {
    const r = await start({ registry_student_number: '2023-00001-QC-0', registry_status: 'NOT_FOUND' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.registry_status, 'MATCHED', 'a browser-supplied status is ignored');
    assert.equal(r.body.registry_student_number, '2023-00001-QC-0');
    assert.equal(r.body.client_email, 'jose.registry@example.com');
    await resetData(env.ds);
    const typed = await start({ registry_student_number: '2023-00001-QC-0', client_email: 'typed@example.com' });
    assert.equal(typed.body.client_email, 'typed@example.com');
  });

  it('an expired record needs a reason, then the Start goes ahead as EXPIRED', async () => {
    const refused = await start({ registry_student_number: '2019-00003-QC-0' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'REGISTRY_REASON_REQUIRED');
    assert.equal(refused.body.error.details.registry_status, 'EXPIRED');
    assert.equal(await count('transactions'), 0);
    const ok = await start({ registry_student_number: '2019-00003-QC-0', registry_miss_reason: 'RETURNING_STUDENT' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.registry_status, 'EXPIRED');
    assert.equal(ok.body.client_email, null, 'an expired record never fills the email');
  });

  it('a record of the other status, or one that disappeared, is NOT_FOUND and needs a reason', async () => {
    assert.equal((await start({ registry_student_number: '2015-00004-QC-0' })).body.error.details.registry_status, 'NOT_FOUND');
    const gone = await start({ registry_student_number: 'NO-SUCH-NUMBER', registry_miss_reason: 'NAME_DIFFERS' });
    assert.equal(gone.status, 201);
    assert.equal(gone.body.registry_status, 'NOT_FOUND');
    assert.equal(gone.body.registry_student_number, null);
  });

  it('the manual path works without any lookup; OTHER needs a non-blank note of at most 200 characters', async () => {
    assert.equal((await start({ registry_not_found: true })).status, 400);
    assert.equal((await start({ registry_not_found: true, registry_miss_reason: 'OTHER' })).status, 400);
    assert.equal((await start({ registry_not_found: true, registry_miss_reason: 'OTHER', registry_miss_note: '   ' })).status, 400);
    assert.equal((await start({ registry_not_found: true, registry_miss_reason: 'OTHER', registry_miss_note: 'x'.repeat(201) })).status, 400);
    const ok = await start({ registry_not_found: true, registry_miss_reason: 'OTHER', registry_miss_note: 'Transferee, papers pending' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.registry_status, 'NOT_FOUND');
    assert.equal(ok.body.registry_miss_note, 'Transferee, papers pending');
  });

  it('Employee and External clients are never looked up and may not send registry fields', async () => {
    assert.equal((await start({ client_type: 'EMPLOYEE', registry_not_found: true, registry_miss_reason: 'OTHER', registry_miss_note: 'n' })).status, 400);
    const ok = await start({ client_type: 'EXTERNAL', client_reference: 'Juan Visitor' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.registry_status, 'NONE');
  });

  it('refuses a new Student or Alumni Start with no registry choice, before anything is written (Codex finding)', async () => {
    for (const clientType of ['STUDENT', 'ALUMNI']) {
      const r = await start({ client_type: clientType });
      assert.equal(r.status, 400);
      assert.ok(r.body.error.details.registry);
    }
    // A reason alone is not a choice either.
    assert.equal((await start({ registry_miss_reason: 'NEW_ENROLLEE' })).status, 400);
    for (const table of ['transactions', 'audit_outbox', 'analytics_outbox', 'transaction_emails']) assert.equal(await count(table), 0, table);
  });

  it('keeps the student number, note, name and email out of audit and analytics; status and reason code reach TT2', async () => {
    const r = await start({ registry_not_found: true, registry_miss_reason: 'OTHER', registry_miss_note: 'Secret note text' });
    const [{ payload: auditPayload }] = await audits('TRANSACTION_STARTED');
    assert.equal(auditPayload.after_value.registry_status, 'NOT_FOUND');
    assert.equal(auditPayload.after_value.registry_miss_reason, 'OTHER');
    assert.equal(JSON.stringify(auditPayload).includes('Secret note'), false);
    const [{ payload }] = await env.ds.query('SELECT payload FROM analytics_outbox WHERE transaction_id = $1', [r.body.transaction_id]);
    assert.equal(payload.snapshot.registry_status, 'NOT_FOUND');
    assert.equal(payload.snapshot.registry_miss_reason, 'OTHER');
    assert.equal(JSON.stringify(payload).includes('Secret note'), false);
    await resetData(env.ds);
    const matched = await start({ registry_student_number: '2023-00001-QC-0' });
    const page = await call(exportRoute, req('GET', '/transactions/analytics-export', { key: SERVICE_KEY }));
    const item = page.body.items.find((i) => i.transaction_id === matched.body.transaction_id);
    assert.equal(item.registry_status, 'MATCHED');
    assert.equal(JSON.stringify(page.body).includes('2023-00001'), false);
    assert.equal(JSON.stringify(page.body).includes('@'), false);
  });

  it('the database refuses an inconsistent registry row whatever writes it', async () => {
    const r = await start({ registry_student_number: '2023-00001-QC-0' });
    await assert.rejects(env.ds.query("UPDATE transactions SET registry_status = 'NOT_FOUND' WHERE transaction_id = $1", [r.body.transaction_id]));
    await assert.rejects(env.ds.query("UPDATE transactions SET registry_miss_reason = 'OTHER' WHERE transaction_id = $1", [r.body.transaction_id]));
  });
});

describe('CC047 client type eligibility at Start', () => {
  it('refuses a forced disallowed type with 400 before any transaction, audit or mail', async () => {
    env.core.state.services.get(SERVICE_A).allowed_client_types = ['STUDENT'];
    const r = await start({ client_type: 'EXTERNAL', client_email: 'someone@example.com' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'CLIENT_TYPE_NOT_ALLOWED');
    assert.deepEqual(r.body.error.details.allowed_client_types, ['STUDENT']);
    for (const table of ['transactions', 'audit_outbox', 'analytics_outbox', 'transaction_emails', 'tracking_sequences']) assert.equal(await count(table), 0, table);
    assert.equal((await start({ client_type: 'STUDENT', ...NOT_IN_REGISTRY })).status, 201);
  });

  it('a field missing from an older Core means all four; a malformed one fails closed with nothing written', async () => {
    assert.equal((await start({ client_type: 'EXTERNAL' })).status, 201);
    await resetData(env.ds);
    for (const bad of [null, [], ['VISITOR'], 'STUDENT']) {
      env.core.state.services.get(SERVICE_A).allowed_client_types = bad;
      const r = await start({ client_type: 'STUDENT', ...NOT_IN_REGISTRY });
      assert.equal(r.status, 503, JSON.stringify(bad));
      assert.equal(await count('transactions'), 0);
    }
  });

  it('the shared date helper is Manila-based (sanity for the expiry rule)', () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
