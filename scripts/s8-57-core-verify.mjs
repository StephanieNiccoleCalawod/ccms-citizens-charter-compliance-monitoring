// S8-57: local-only verification and synthetic contract evidence; never load application .env files.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseExceptionInput, toEngineEntry } from '../apps/core-service/src/lib/calendar/exceptions.js';
import { buildMessage, buildFmsMessage, CHANGE_KIND } from '../apps/core-service/src/lib/calendar/message.js';

const directory = fileURLToPath(new URL('../docs/evidence/S8-57-Core-20261128/', import.meta.url));
await mkdir(directory, { recursive: true });
const save = (file, value) => writeFile(`${directory}/${file}`, `${JSON.stringify(value, null, 2)}\n`);
const body = { exception_date: '2026-12-08', exception_type: 'REGULAR_HOLIDAY', description: 'Synthetic holiday verification' };
const input = parseExceptionInput(body);
assert.equal(input.reasonCategory, 'HOLIDAY_PROCLAMATION');
const entry = toEngineEntry({ ...input, exceptionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 });
const shared = { messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', entry, date: body.exception_date, changeKind: CHANGE_KIND.UPSERT };
const fmsOptions = { target: { termId: 'sms:ccms-test:term:2026-1S', artifactRevision: 'ccms-fms-calendar-v3' }, sourceTimestamp: new Date('2026-11-28T00:00:00Z') };
const cal10 = buildMessage(shared);
const fms3 = buildFmsMessage({ ...shared, ...fmsOptions });
assert.equal(cal10.schemaVersion, 'cal-1.0');
assert.equal(fms3.schemaVersion, 3);
for (const payload of [cal10, fms3]) assert.doesNotMatch(JSON.stringify(payload), /reason_category|reasonCategory/);
assert.deepEqual(buildMessage({ ...shared, entry: { ...entry, reason_category: 'OTHER' } }), cal10);
assert.deepEqual(buildFmsMessage({ ...shared, ...fmsOptions, entry: { ...entry, reason_category: 'OTHER' } }), fms3);
await save('contract-samples.json', { synthetic: true, decision: 'Keep outgoing feed formats unchanged; reason remains in CCMS.', cal10, fms3 });
console.log('PASS: real serializers keep cal-1.0 and FMS schema 3 unchanged, without a reason field.');

if (process.argv.includes('--with-db')) {
  const testUrl = process.env.TEST_PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
  const host = new URL(testUrl).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('Only a loopback test PostgreSQL server is allowed.');
  process.env.TEST_PG_URL = testUrl;
  // No provider URLs or secrets are used by this local verification process.
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'LOGS_SERVICE_URL', 'FMS_URL', 'SMS_URL', 'AUDIT_URL', 'IDENTITY_URL', 'CAL_WINDOW_FROM', 'CAL_WINDOW_TO']) delete process.env[key];
  const { POST } = await import('../apps/core-service/src/app/api/exceptions/route.js');
  const { PUT } = await import('../apps/core-service/src/app/api/exceptions/[id]/route.js');
  const { setupTestEnv, req, ctx, tokens } = await import('../apps/core-service/test/calendar-helpers.js');
  let env;
  const evidence = [];
  try {
    env = await setupTestEnv();
    const call = async (handler, method, value, id) => {
      const request = req(method, id ? `/exceptions/${id}` : '/exceptions', { token: tokens.superAdmin, body: value });
      const sent = await request.clone().json();
      const response = await handler(request, id ? ctx(id) : undefined);
      return { request: sent, status: response.status, response: await response.json() };
    };
    let holidayId;
    for (const [index, type] of ['REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'LOCAL_HOLIDAY'].entries()) {
      const result = await call(POST, 'POST', { ...body, exception_type: type, exception_date: `2026-12-${String(8 + index).padStart(2, '0')}`, reason_category: undefined });
      assert.equal(Object.hasOwn(result.request, 'reason_category'), false);
      assert.equal(result.status, 201);
      const id = result.response.exception.exception_id;
      if (!holidayId) holidayId = id;
      const [stored] = await env.ds.query('SELECT reason_category FROM calendar_exceptions WHERE exception_id=$1', [id]);
      assert.equal(stored.reason_category, 'HOLIDAY_PROCLAMATION');
      const queued = await env.ds.query('SELECT consumer_system, payload FROM sync_log WHERE entity_id=$1 ORDER BY consumer_system', [id]);
      assert.deepEqual(queued.map((row) => row.consumer_system), ['AUDIT', 'FMS']);
      for (const row of queued) assert.doesNotMatch(JSON.stringify(row.payload), /reason_category|reasonCategory/);
      evidence.push({ case: type, ...result, stored, queued });
    }
    const suspension = { ...body, exception_date: '2026-12-11', exception_type: 'SUSPENSION', reason_category: undefined };
    const missing = await call(POST, 'POST', suspension);
    assert.equal(missing.status, 400);
    assert.equal(missing.response.error.details.reason_category, 'Choose a reason category');
    const [count] = await env.ds.query("SELECT count(*)::int AS n FROM calendar_exceptions WHERE exception_date='2026-12-11'");
    assert.equal(count.n, 0);
    evidence.push({ case: 'suspension without reason rejected without saving', ...missing, savedRows: count.n });
    const conversion = await call(PUT, 'PUT', { ...suspension, exception_date: '2026-12-08' }, holidayId);
    assert.equal(conversion.status, 400);
    assert.equal(conversion.response.error.details.reason_category, 'Choose a reason category');
    const [original] = await env.ds.query('SELECT exception_type,reason_category FROM calendar_exceptions WHERE exception_id=$1', [holidayId]);
    assert.equal(original.exception_type, 'REGULAR_HOLIDAY');
    evidence.push({ case: 'holiday-to-suspension without reason rejected', ...conversion, unchangedStored: original });
    const valid = await call(POST, 'POST', { ...suspension, reason_category: 'TYPHOON_WEATHER' });
    assert.equal(valid.status, 201);
    assert.equal(valid.response.exception.reason_category, 'TYPHOON_WEATHER');
    evidence.push({ case: 'suspension with valid reason saved', ...valid });
    await save('local-http-and-database.json', { synthetic: true, productionChanged: false, cases: evidence });
    console.log('PASS: 3 holiday types saved without input reason; stored reason verified; actual queued feeds unchanged.');
    console.log('PASS: suspension without reason rejected (400) with field message and no saved row.');
    console.log('PASS: holiday-to-suspension conversion requires a reason; valid suspension saves.');
  } finally {
    await env?.teardown();
  }
} else {
  console.log('Database/HTTP verification not requested; use --with-db with a loopback test PostgreSQL server.');
}
