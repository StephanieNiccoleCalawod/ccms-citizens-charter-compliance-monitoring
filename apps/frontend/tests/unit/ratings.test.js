// CC057 service rating: rules, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { RatingApiError, getRatingSummary, getTransactionRatingCode, submitRating } from '../../src/lib/api/ratings.js';
import { averageText, cleanCode, ratingErrors, ratingFailure, showCode } from '../../src/lib/ui/ratings.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });

describe('code and form rules', () => {
  it('tidies what is typed', () => {
    assert.equal(cleanCode(' abcd-efgh jkmn99 '), 'ABCDEFGHJKMN');
    assert.equal(showCode('abcdefghjkmn'), 'ABCD-EFGH-JKMN');
    assert.equal(showCode('abcde'), 'ABCD-E');
  });
  it('needs a 12-character code without look-alikes and 1 to 5 stars', () => {
    assert.deepEqual(ratingErrors({ code: 'ABCD-EFGH-JKMN', stars: 3 }), {});
    assert.ok(ratingErrors({ code: 'ABCD', stars: 3 }).code);
    assert.ok(ratingErrors({ code: 'ABCD-EFGH-JKM0', stars: 3 }).code); // 0 is never in a code
    assert.ok(ratingErrors({ code: 'ABCDEFGHJKMN', stars: 0 }).stars);
    assert.ok(ratingErrors({ code: 'ABCDEFGHJKMN', stars: 6 }).stars);
  });
  it('words a refused code the same way for a wrong code and a used one', () => {
    assert.match(ratingFailure({ status: 409 }), /not valid or has already been used/);
    assert.equal(ratingFailure({ status: 429, message: 'Too many attempts.' }), 'Too many attempts.');
    assert.equal(averageText(null), '–'); assert.equal(averageText(4.5), '4.50 / 5');
  });
});

describe('calls', () => {
  it('sends only the code and the stars', async () => {
    let seen;
    const out = await submitRating({ code: 'ABCDEFGHJKMN', stars: 4, comment: 'x' }, async (url, init) => { seen = [url, init]; return reply(201, { rated: true }); });
    assert.equal(out.rated, true);
    assert.equal(seen[0], '/api/operations/ratings');
    assert.equal(seen[1].method, 'POST');
    assert.deepEqual(JSON.parse(seen[1].body), { code: 'ABCDEFGHJKMN', stars: 4 });
  });
  it('turns failures into readable errors', async () => {
    await assert.rejects(submitRating({ code: 'x', stars: 1 }, async () => reply(409, { error: { message: 'Used.' } })), (e) => e instanceof RatingApiError && e.status === 409 && e.message === 'Used.');
    await assert.rejects(submitRating({ code: 'x', stars: 1 }, async () => { throw new Error('offline'); }), /Cannot reach the server/);
  });
  it('read the summary and the code through the gateway', async () => {
    const calls = [];
    const f = async (p) => { calls.push(p); return {}; };
    await getRatingSummary({ officeId: 'o1', from: '2026-11-01', to: '2026-11-30' }, f);
    await getTransactionRatingCode('t 1', f);
    assert.deepEqual(calls, ['/api/operations/ratings/summary?office_id=o1&from=2026-11-01&to=2026-11-30', '/api/operations/transactions/t%201/rating-code']);
  });
});

describe('screens', () => {
  it('the public page is outside the app shell and asks for no personal data', () => {
    const page = read('src/components/ratings/RatePage.js');
    assert.ok(!page.includes('AppShell') && !/type="email"|<textarea|<input[^>]*\bname=/i.test(page));
    assert.match(read('src/app/rate/page.js'), /RatePage/);
  });
  it('the ratings table sits in the report beside, not inside, the compliance figures', () => {
    const reports = read('src/components/reports/ReportsPage.js');
    assert.match(reports, /<FiguresTable report=\{report\} \/>\s*<RatingsSection/);
    assert.ok(!read('src/lib/ui/reports.js').includes('rating'));
  });
  it('staff see the code on a completed transaction only', () => {
    assert.match(read('src/components/transactions/TransactionDetail.js'), /tx\.status === 'COMPLETED' \? <RatingCodePanel/);
  });
});
