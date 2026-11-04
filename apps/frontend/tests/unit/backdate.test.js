import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { getServiceStandardAsOf, listRecordsOnDate } from '../../src/lib/api/backdate.js';
import { TRANSACTIONS_API, completeTransaction } from '../../src/lib/api/transactions.js';
import { completeErrorResult } from '../../src/lib/ui/complete-transaction.js';
import { BACKDATE_MESSAGES, BACKDATE_REASON_MAX, COMPLETION_END_MESSAGES, EMPTY_MANUAL_END, EMPTY_PAST, backdateErrors, completionBody, isAmbiguousWrite, manilaDateOf, manualEndErrors, manilaInstant, manilaIso, pastStandardMessage, withBackdate } from '../../src/lib/ui/backdate.js';
import { EMPTY_START_FORM, buildStartBody, startErrorResult } from '../../src/lib/ui/start-transaction.js';

// MOCKED fetchers and values shaped like the real contract (Operations time.js parseBackdate and start.js; Core standard asOf).
// The clock is passed in as a number, so none of these tests depends on the machine's time zone.
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const SERVICE = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-24T06:00:00Z'); // 2:00 PM on 10/24/2026 in Manila
const past = (o = {}) => ({ ...EMPTY_PAST, enabled: true, started_at: '2026-10-20T09:00', reason: 'Written down on paper', ...o });

describe('Manila date and time handling', () => {
  it('reads a typed Manila time as the instant 8 hours earlier in UTC', () => {
    assert.equal(manilaInstant('2026-10-20T09:00'), Date.parse('2026-10-20T01:00:00Z'));
    assert.equal(manilaInstant('2026-10-20T00:30'), Date.parse('2026-10-19T16:30:00Z'));
    assert.equal(manilaInstant('2026-10-20T09:00:30'), Date.parse('2026-10-20T01:00:30Z'));
  });
  it('sends the ISO form with the +08:00 offset that the service requires', () => {
    assert.equal(manilaIso('2026-10-20T09:00'), '2026-10-20T09:00:00+08:00');
    assert.equal(manilaIso('2026-10-20T09:00:15'), '2026-10-20T09:00:15+08:00');
    assert.equal(manilaIso('nonsense'), null);
  });
  it('the Manila date of the start is the typed date, even just after midnight (no browser time zone is involved)', () => {
    assert.equal(manilaDateOf('2026-10-20T00:05'), '2026-10-20');
    assert.equal(manilaDateOf('2026-10-20T23:59'), '2026-10-20');
  });
  it('refuses dates that do not exist or are not complete', () => {
    for (const bad of ['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-10-20', '2026-10-20T25:00', '2026-10-20T10:61', null, undefined]) assert.equal(manilaInstant(bad), null, String(bad));
    assert.equal(manilaDateOf('2026-02-30T10:00'), null);
  });
  it('gives the same answers under any process time zone', () => {
    const before = process.env.TZ;
    for (const tz of ['UTC', 'Asia/Manila', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(manilaIso('2026-03-08T02:30'), '2026-03-08T02:30:00+08:00', tz);
      assert.equal(manilaInstant('2026-03-08T02:30'), Date.parse('2026-03-07T18:30:00Z'), tz);
    }
    process.env.TZ = before;
  });
});

describe('early checks (the service checks again)', () => {
  it('does nothing when the option is off', () => {
    assert.deepEqual(backdateErrors(EMPTY_PAST, NOW), {});
    assert.deepEqual(backdateErrors({ ...EMPTY_PAST, started_at: 'junk' }, NOW), {});
  });
  it('accepts a past start with a reason', () => {
    assert.deepEqual(backdateErrors(past(), NOW), {});
  });
  it('requires the start and refuses an unreadable one', () => {
    assert.equal(backdateErrors(past({ started_at: '' }), NOW).started_at, BACKDATE_MESSAGES.startRequired);
    assert.equal(backdateErrors(past({ started_at: '2026-02-30T10:00' }), NOW).started_at, BACKDATE_MESSAGES.startInvalid);
  });
  it('refuses a start in the future or exactly now (Manila time)', () => {
    assert.equal(backdateErrors(past({ started_at: '2026-10-24T14:01' }), NOW).started_at, BACKDATE_MESSAGES.startFuture);
    assert.equal(backdateErrors(past({ started_at: '2026-10-24T14:00' }), NOW).started_at, BACKDATE_MESSAGES.startFuture);
    assert.equal(backdateErrors(past({ started_at: '2026-10-24T13:59' }), NOW).started_at, undefined);
    // 10/24 10:00 PM Manila is still tomorrow's evening in UTC terms: must be refused as future.
    assert.equal(backdateErrors(past({ started_at: '2026-10-24T22:00' }), NOW).started_at, BACKDATE_MESSAGES.startFuture);
  });
  it('requires a reason; whitespace is not a reason; 500 characters at most', () => {
    for (const reason of ['', '   ', '\n\t']) assert.equal(backdateErrors(past({ reason }), NOW).backdate_reason, BACKDATE_MESSAGES.reasonRequired);
    assert.equal(backdateErrors(past({ reason: 'x'.repeat(500) }), NOW).backdate_reason, undefined);
    assert.equal(backdateErrors(past({ reason: 'x'.repeat(501) }), NOW).backdate_reason, BACKDATE_MESSAGES.reasonTooLong);
    assert.equal(BACKDATE_REASON_MAX, 500);
  });
  it('a manual end is required, not in the future, and strictly after the start', () => {
    const base = past({ manual_end: true });
    assert.equal(backdateErrors({ ...base, ended_at: '' }, NOW).ended_at, BACKDATE_MESSAGES.endRequired);
    assert.equal(backdateErrors({ ...base, ended_at: '2026-02-30T10:00' }, NOW).ended_at, BACKDATE_MESSAGES.endInvalid);
    assert.equal(backdateErrors({ ...base, ended_at: '2026-10-24T14:01' }, NOW).ended_at, BACKDATE_MESSAGES.endFuture);
    assert.equal(backdateErrors({ ...base, ended_at: '2026-10-20T09:00' }, NOW).ended_at, BACKDATE_MESSAGES.endAfterStart); // equal
    assert.equal(backdateErrors({ ...base, ended_at: '2026-10-20T08:59' }, NOW).ended_at, BACKDATE_MESSAGES.endAfterStart); // before
    assert.equal(backdateErrors({ ...base, ended_at: '2026-10-20T09:01' }, NOW).ended_at, undefined);
    assert.equal(backdateErrors({ ...base, ended_at: '2026-10-24T14:00' }, NOW).ended_at, undefined); // exactly now is allowed for the end
  });
  it('an end typed but not switched on is ignored', () => {
    assert.deepEqual(backdateErrors(past({ manual_end: false, ended_at: 'junk' }), NOW), {});
  });
});

describe('the request body (MOCKED)', () => {
  const base = buildStartBody({ form: { ...EMPTY_START_FORM, service_id: SERVICE, client_type: 'STUDENT' }, countersEnabled: false });
  it('an ordinary start is exactly what it was', () => {
    assert.deepEqual(withBackdate(base, EMPTY_PAST), { service_id: SERVICE, client_type: 'STUDENT', requirements_confirmed: true });
    assert.deepEqual(withBackdate(base, { ...EMPTY_PAST, started_at: '2026-10-20T09:00', reason: 'ignored while off' }), base);
  });
  it('a past start adds only started_at and backdate_reason (trimmed)', () => {
    assert.deepEqual(withBackdate(base, past({ reason: '  Written down on paper  ' })), { ...base, started_at: '2026-10-20T09:00:00+08:00', backdate_reason: 'Written down on paper' });
  });
  it('a past start with a manual end records the finished transaction in the same request', () => {
    assert.deepEqual(withBackdate(base, past({ manual_end: true, ended_at: '2026-10-20T09:45' })), { ...base, started_at: '2026-10-20T09:00:00+08:00', ended_at: '2026-10-20T09:45:00+08:00', backdate_reason: 'Written down on paper' });
  });
  it('never carries a result, status, tracking number or flag', () => {
    const body = withBackdate(base, past({ manual_end: true, ended_at: '2026-10-20T09:45' }));
    for (const key of ['status', 'tracking_no', 'is_backdated', 'is_compliant', 'elapsed_working_minutes', 'variance_minutes', 'held_minutes']) assert.ok(!(key in body), key);
  });
});

describe('server answers', () => {
  it('maps the 400 details of the backdating fields onto their inputs', () => {
    const r = startErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { started_at: 'Time cannot be in the future', ended_at: 'End must be after start', backdate_reason: 'Enter why this time is entered after the fact' }));
    assert.equal(r.kind, 'validation');
    assert.deepEqual(r.fieldErrors, { started_at: 'Time cannot be in the future', ended_at: 'End must be after start', backdate_reason: 'Enter why this time is entered after the fact' });
  });
  it('uses the service\'s own words only for the "no standard on that day" refusal', () => {
    assert.equal(pastStandardMessage(apiError(409, 'STANDARD_NOT_IN_FORCE', 'No standard was in force for this service on 10/01/2026')), 'No standard was in force for this service on 10/01/2026');
    assert.equal(pastStandardMessage(apiError(409, 'STANDARD_NOT_IN_FORCE', 'Something else <b>x</b>')), null);
    assert.equal(pastStandardMessage(apiError(500, 'X', 'No standard was in force for this service on 10/01/2026')), null);
  });
  it('an unclear outcome is a network failure or a server/gateway failure, but not the refusal made before saving', () => {
    assert.equal(isAmbiguousWrite(apiError(undefined, 'NETWORK_ERROR')), true);
    assert.equal(isAmbiguousWrite(apiError(500, 'INTERNAL_ERROR')), true);
    assert.equal(isAmbiguousWrite(apiError(502, 'X')), true);
    assert.equal(isAmbiguousWrite(apiError(504, 'X')), true);
    assert.equal(isAmbiguousWrite(apiError(503, 'SERVICE_UNAVAILABLE')), true);
    assert.equal(isAmbiguousWrite(apiError(503, 'CATALOGUE_UNAVAILABLE')), false);
    for (const [status, code] of [[400, 'VALIDATION_ERROR'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'OPEN_TRANSACTION_EXISTS'], [409, 'STANDARD_NOT_IN_FORCE']]) assert.equal(isAmbiguousWrite(apiError(status, code)), false, `${status} ${code}`);
  });
});

describe('the two extra reads (MOCKED fetcher)', () => {
  it('asks Core for the standard of the typed Manila date', async () => {
    const urls = [];
    await getServiceStandardAsOf(SERVICE, '2026-10-20', async (url) => (urls.push(url), {}));
    assert.deepEqual(urls, [`/api/catalogue/services/${SERVICE}/standard?asOf=2026-10-20`]);
  });
  it('checks saved records by service and Manila date only', async () => {
    const urls = [];
    await listRecordsOnDate({ serviceId: SERVICE, date: '2026-10-20' }, async (url) => (urls.push(url), { items: [] }));
    assert.deepEqual(urls, [`/api/operations/transactions?service_id=${SERVICE}&from=2026-10-20&to=2026-10-20&page_size=50`]);
  });
});

describe('the screen (source checks)', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const page = strip((read('src/app/transactions/new/page.js') + read('src/components/transactions/StartTransactionForm.js')));
  const rules = strip(read('src/lib/ui/backdate.js'));
  it('has one create call; no completion call; no job, report or audit calls', () => {
    assert.equal((page.match(/postTransaction\(/g) ?? []).length, 1);
    assert.ok(!/completeTransaction|compute-pending|jobs\/|audit/i.test(page + rules));
  });
  it('works out no result, historical standard or working minutes', () => {
    for (const code of [page, rules]) assert.ok(!/elapsed_working_minutes\s*[-+*<>]|variance_minutes\s*[-+*<>]|is_compliant\s*=[^=]/.test(code));
    assert.ok(!/toISOString|getTimezoneOffset|toLocale|getHours|getMinutes|getFullYear|getDate\(|getMonth/.test(rules), 'no browser time zone use in the rules (only UTC arithmetic)');
  });
  it('locks the form after an unclear past write until the saved records are checked', () => {
    assert.ok(/isAmbiguousWrite\(err\)/.test(page));
    assert.ok(/!locked/.test(page));
    assert.ok(/listRecordsOnDate\(/.test(page));
  });
});

describe('completing an open transaction with an end time entered by hand (MOCKED)', () => {
  // The start comes back from the server as an instant: 9:00 AM Manila on 10/20/2026.
  const STARTED = '2026-10-20T01:00:00.000Z';
  const manual = (o = {}) => ({ ...EMPTY_MANUAL_END, enabled: true, ended_at: '2026-10-20T09:45', reason: 'Finished earlier, recorded now', ...o });

  it('does nothing and sends no body when the option is off (ordinary completion)', () => {
    assert.deepEqual(manualEndErrors(EMPTY_MANUAL_END, STARTED, NOW), {});
    assert.deepEqual(manualEndErrors({ ...EMPTY_MANUAL_END, ended_at: 'junk' }, STARTED, NOW), {});
    assert.equal(completionBody(EMPTY_MANUAL_END), undefined);
  });
  it('accepts a real end after the stored start and a reason', () => {
    assert.deepEqual(manualEndErrors(manual(), STARTED, NOW), {});
  });
  it('requires the end and refuses an unreadable one', () => {
    assert.equal(manualEndErrors(manual({ ended_at: '' }), STARTED, NOW).ended_at, BACKDATE_MESSAGES.endRequired);
    assert.equal(manualEndErrors(manual({ ended_at: '2026-02-30T10:00' }), STARTED, NOW).ended_at, BACKDATE_MESSAGES.endInvalid);
  });
  it('refuses an end in the future (Manila time), allows exactly now', () => {
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-24T14:01' }), STARTED, NOW).ended_at, BACKDATE_MESSAGES.endFuture);
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-24T14:00' }), STARTED, NOW).ended_at, undefined);
  });
  it('requires the end to be strictly after the server-returned start', () => {
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-20T09:00' }), STARTED, NOW).ended_at, COMPLETION_END_MESSAGES.endBeforeStoredStart); // equal
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-20T08:59' }), STARTED, NOW).ended_at, COMPLETION_END_MESSAGES.endBeforeStoredStart); // before
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-20T09:01' }), STARTED, NOW).ended_at, undefined);
    // 12:30 AM Manila on 10/20 is 4:30 PM UTC on 10/19: the Manila reading decides, not the UTC date.
    assert.equal(manualEndErrors(manual({ ended_at: '2026-10-20T00:30' }), STARTED, NOW).ended_at, COMPLETION_END_MESSAGES.endBeforeStoredStart);
  });
  it('requires a reason; whitespace is not one; 500 characters at most', () => {
    for (const reason of ['', '   ', '\n']) assert.equal(manualEndErrors(manual({ reason }), STARTED, NOW).backdate_reason, BACKDATE_MESSAGES.reasonRequired);
    assert.equal(manualEndErrors(manual({ reason: 'x'.repeat(501) }), STARTED, NOW).backdate_reason, BACKDATE_MESSAGES.reasonTooLong);
    assert.equal(manualEndErrors(manual({ reason: 'x'.repeat(500) }), STARTED, NOW).backdate_reason, undefined);
  });
  it('builds exactly { ended_at, backdate_reason }: no start, result, status or flag', () => {
    const body = completionBody(manual({ reason: '  Finished earlier  ' }));
    assert.deepEqual(body, { ended_at: '2026-10-20T09:45:00+08:00', backdate_reason: 'Finished earlier' });
    for (const key of ['started_at', 'status', 'is_compliant', 'elapsed_working_minutes', 'variance_minutes', 'is_backdated']) assert.ok(!(key in body), key);
  });
  it('the completion helper sends the body only when there is one', async () => {
    const calls = [];
    const fetcher = async (url, options) => { calls.push({ url, options }); return {}; };
    await completeTransaction(ID, fetcher);
    await completeTransaction(ID, fetcher, completionBody(manual()));
    assert.deepEqual(calls[0].options, { method: 'POST' });
    assert.deepEqual(calls[1].options, { method: 'POST', body: { ended_at: '2026-10-20T09:45:00+08:00', backdate_reason: 'Finished earlier, recorded now' } });
    assert.equal(calls[1].url, `${TRANSACTIONS_API}/${ID}/complete`);
  });
  it('maps the service\'s 400 on the two fields so the dialog can show them', () => {
    const r = completeErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { ended_at: 'End must be after start', backdate_reason: 'Enter why this time is entered after the fact' }));
    assert.equal(r.kind, 'validation');
    assert.deepEqual(r.fieldErrors, { ended_at: 'End must be after start', backdate_reason: 'Enter why this time is entered after the fact' });
  });
  it('409, network and server failures keep their existing handling (state read back, no blind retry)', () => {
    assert.equal(completeErrorResult(apiError(409, 'INVALID_STATE', 'x', { status: 'COMPLETED' })).reload, true);
    for (const e of [apiError(undefined, 'NETWORK_ERROR'), apiError(500, 'X'), apiError(502, 'X')]) {
      const r = completeErrorResult(e);
      assert.deepEqual([r.unknown, r.reload], [true, true]);
    }
  });
  it('the screen has one completion call, the manual end is checked before anything is sent, and no start is ever sent', () => {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const page = strip((read('src/app/transactions/[id]/page.js') + read('src/components/transactions/TransactionDetail.js')));
    assert.equal((page.match(/completeTransaction\(/g) ?? []).length, 1);
    assert.ok(/manualEndErrors\(manualEnd, tx\.started_at, Date\.now\(\)\)/.test(page));
    assert.ok(/completeTransaction\(id, undefined, completionBody\(manualEnd\)\)/.test(page));
    assert.ok(!/started_at\s*:/.test(page));
  });
});
