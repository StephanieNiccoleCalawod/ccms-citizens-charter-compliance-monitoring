// Sprint 7 CC057: rate the service once with the code from the receipt. The database is real.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as codeRoute } from '../src/app/api/transactions/[id]/rating-code/route.js';
import { POST as rateRoute } from '../src/app/api/ratings/route.js';
import { GET as summaryRoute } from '../src/app/api/ratings/summary/route.js';
import { completeTransaction } from '../src/modules/transaction/complete.js';
import { createCoreClient } from '../src/modules/transaction/core-client.js';
import { buildReceipt } from '../src/modules/transaction/receipt.js';
import { CODE_PATTERN, formatCode, newRatingCode, normalizeCode } from '../src/modules/ratings/ratings.js';
import { setRatingLimiter } from '../src/modules/ratings/limit.js';
import { OFFICE_A, OFFICE_B, SERVICE_A, SERVICE_B, USERS, at, call, ctx, insertTransaction, req, resetData, seedCoreServices, setupTestEnv, staff, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); seedCoreServices(env.core); setRatingLimiter({ check: async () => ({ allowed: true }) }); });
after(async () => { setRatingLimiter(null); await env?.teardown(); });
beforeEach(async () => { env.core.reset(); await resetData(env.ds); });

const deps = () => ({ core: createCoreClient(), now: () => new Date('2026-10-06T10:45:00+08:00') });
async function finished(over = {}) {
  const t = await insertTransaction(env.ds, { started_by: USERS.staffA, office_id: OFFICE_A, started_at: new Date(at('2026-10-06', '10:00')), ...over });
  await completeTransaction(env.ds, deps(), staff(USERS.staffA), t.transaction_id, {});
  return t;
}
const rate = (body) => call(rateRoute, req('POST', '/ratings', { body }));
const summary = (token, q = '') => call(summaryRoute, req('GET', `/ratings/summary${q}`, { token }));
const codeOf = async (id) => (await env.ds.query('SELECT rating_code FROM service_ratings WHERE transaction_id = $1', [id]))[0]?.rating_code;

describe('codes', () => {
  it('look right and avoid look-alike characters', () => {
    for (let i = 0; i < 200; i += 1) assert.match(newRatingCode(), CODE_PATTERN);
    assert.equal(formatCode('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN');
    assert.equal(normalizeCode(' abcd-efgh-jkmn '), 'ABCDEFGHJKMN');
  });
  it('one code is issued when a transaction completes, and none before', async () => {
    const open = await insertTransaction(env.ds, { started_by: USERS.staffA2, office_id: OFFICE_A });
    assert.equal(await codeOf(open.transaction_id), undefined);
    const t = await finished();
    assert.match(await codeOf(t.transaction_id), CODE_PATTERN);
  });
  it('is on the receipt email, and the email still has no compliance result', async () => {
    const t = await finished();
    const code = await codeOf(t.transaction_id);
    const mail = buildReceipt({ client_email: 'a@b.ph', tracking_no: 'T-1', service_name: 'S', office_name: 'O', started_at: new Date(), ended_at: new Date(), rating_code: code });
    assert.ok(mail.text.includes(formatCode(code)));
    assert.ok(!/complian|breach|variance|staff|started_by/i.test(mail.text));
    assert.ok(!buildReceipt({ tracking_no: 'T-1', service_name: 'S', started_at: new Date(), ended_at: new Date() }).text.includes('rating code'));
  });
  it('staff of the office can read it, other offices and the Executive cannot', async () => {
    const t = await finished();
    const get = (token) => call(codeRoute, req('GET', `/transactions/${t.transaction_id}/rating-code`, { token }), ctx(t.transaction_id));
    const ok = await get(tokens.officeStaffA);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.code, formatCode(await codeOf(t.transaction_id)));
    assert.equal((await get(tokens.officeHeadB)).status, 403);
    assert.equal((await get(tokens.executive)).status, 403);
    assert.equal((await call(codeRoute, req('GET', '/x'), ctx(t.transaction_id))).status, 401);
  });
});

describe('rating', () => {
  it('AC1: a code rates once; a second use is refused (same answer as a wrong code)', async () => {
    const t = await finished();
    const code = formatCode(await codeOf(t.transaction_id));
    const first = await rate({ code, stars: 4 });
    assert.equal(first.status, 201);
    const second = await rate({ code, stars: 5 });
    assert.equal(second.status, 409);
    const wrong = await rate({ code: 'ABCD-EFGH-JKMN', stars: 5 });
    assert.equal(wrong.status, 409);
    assert.equal(second.body.error.message, wrong.body.error.message);
    const [row] = await env.ds.query('SELECT stars FROM service_ratings WHERE transaction_id = $1', [t.transaction_id]);
    assert.equal(row.stars, 4);
  });
  it('refuses stars outside 1 to 5, a missing code, and ignores any free text', async () => {
    const t = await finished();
    const code = await codeOf(t.transaction_id);
    for (const stars of [0, 6, 2.5, '3', null]) assert.equal((await rate({ code, stars })).status, 400, String(stars));
    assert.equal((await rate({ stars: 3 })).status, 400);
    assert.equal((await rate({ code: 'short', stars: 3 })).status, 400);
    assert.equal((await rate({ code, stars: 3, comment: 'Ana Reyes was rude' })).status, 201);
    const row = (await env.ds.query('SELECT * FROM service_ratings WHERE transaction_id = $1', [t.transaction_id]))[0];
    assert.ok(!JSON.stringify(row).includes('Ana Reyes'));
  });
  it('AC3: nothing about a person is kept on a rating', async () => {
    const cols = (await env.ds.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'service_ratings' ORDER BY 1")).map((c) => c.column_name);
    assert.deepEqual(cols, ['issued_at', 'office_id', 'rated_at', 'rating_code', 'rating_id', 'service_code', 'service_id', 'service_name', 'stars', 'transaction_id']);
  });
  it('answers 429 when the limiter says so', async () => {
    setRatingLimiter({ check: async () => ({ allowed: false, retryAfterSeconds: 30 }) });
    try { assert.equal((await rate({ code: 'ABCDEFGHJKMN', stars: 3 })).status, 429); } finally { setRatingLimiter({ check: async () => ({ allowed: true }) }); }
  });
});

describe('summary', () => {
  it('AC2: count and average per service, only rated ones, scoped to the office, apart from compliance', async () => {
    const a1 = await finished();
    const a2 = await finished({ started_by: USERS.staffA });
    const b1 = await finished({ service_id: SERVICE_B, office_id: OFFICE_B, standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, started_by: USERS.staffA });
    await finished(); // issued, never rated
    for (const [t, stars] of [[a1, 5], [a2, 4], [b1, 2]]) await rate({ code: await codeOf(t.transaction_id), stars });
    const all = await summary(tokens.superAdmin);
    assert.equal(all.status, 200);
    assert.equal(all.body.total_count, 3);
    const byService = Object.fromEntries(all.body.items.map((i) => [i.service_id, i]));
    assert.deepEqual([byService[SERVICE_A].count, byService[SERVICE_A].average], [2, 4.5]);
    assert.deepEqual([byService[SERVICE_B].count, byService[SERVICE_B].average], [1, 2]);
    assert.equal(all.body.average, 3.67);
    const own = await summary(tokens.officeHeadA);
    assert.equal(own.body.total_count, 2);
    assert.equal((await summary(tokens.officeHeadA, `?office_id=${OFFICE_B}`)).status, 403);
    assert.equal((await summary(tokens.executive)).status, 200);
    assert.equal((await call(summaryRoute, req('GET', '/ratings/summary'))).status, 401);
    assert.ok(!JSON.stringify(all.body).match(/complian|variance|late/i));
  });
  it('is empty with no ratings, and filters by date', async () => {
    assert.deepEqual((await summary(tokens.superAdmin)).body, { items: [], total_count: 0, average: null });
    assert.equal((await summary(tokens.superAdmin, '?from=bad')).status, 400);
    const t = await finished();
    await rate({ code: await codeOf(t.transaction_id), stars: 3 });
    assert.equal((await summary(tokens.superAdmin, '?from=2099-01-01')).body.total_count, 0);
    assert.equal((await summary(tokens.superAdmin, '?from=2020-01-01&to=2099-01-01')).body.total_count, 1);
  });
});
