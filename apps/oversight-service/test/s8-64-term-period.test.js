import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTerms, pickTermPeriod, resolveTermQuery } from '../src/modules/analytics/term-period.js';
import { resolvePeriod } from '../src/modules/analytics/period.js';

const payload = { items: [
  { term_code: '2026-1S', term_name: '1st Semester', academic_year: '2026-2027', start_date: '2026-08-17', end_date: '2026-12-02' },
  { term_code: '2026-2S', term_name: '2nd Semester', academic_year: '2026-2027', start_date: '2027-01-05', end_date: '2027-05-28' },
  { term_code: 'bad', term_name: 'No dates', start_date: null, end_date: null },
] };
const terms = normalizeTerms(payload);
const fetchOk = async (url) => ({ ok: true, json: async () => (url.endsWith('/terms/sms') ? { enabled: true, state: 'OK', ...payload } : {}) });
const env = { CORE_URL: 'http://core' };

describe('S8-64 term and school-year periods', () => {
  it('drops terms without usable dates', () => assert.equal(terms.length, 2));
  it('a term gives its own dates and a label with the school year', () => {
    assert.deepEqual(pickTermPeriod(terms, { term: '2026-1S' }), { kind: 'term', from: '2026-08-17', to: '2026-12-02', label: '1st Semester, School Year 2026-2027' });
  });
  it('a school year spans all its terms', () => {
    const p = pickTermPeriod(terms, { schoolYear: '2026-2027' });
    assert.equal(p.from, '2026-08-17'); assert.equal(p.to, '2027-05-28'); assert.equal(p.label, 'School Year 2026-2027');
  });
  it('refuses an unknown term, an unknown year and both at once with plain words', () => {
    assert.throws(() => pickTermPeriod(terms, { term: 'x' }), /not found/);
    assert.throws(() => pickTermPeriod(terms, { schoolYear: '1999-2000' }), /not found/);
    assert.throws(() => pickTermPeriod(terms, { term: '2026-1S', schoolYear: '2026-2027' }), /not both/);
  });
  it('the query becomes the same custom range the figures already understand', async () => {
    const { query, label } = await resolveTermQuery({ term: '2026-1S', period_label: 'spoofed' }, { authorization: 'Bearer t', env, fetchImpl: fetchOk });
    assert.equal(label, '1st Semester, School Year 2026-2027');
    assert.deepEqual(resolvePeriod(query), { type: 'custom', from: '2026-08-17', to: '2026-12-02' });
    assert.equal(query.period_label, undefined);
  });
  it('without a term the query passes through and Core is not called', async () => {
    const { query, label } = await resolveTermQuery({ period: 'monthly' }, { env, fetchImpl: async () => { throw new Error('no call'); } });
    assert.equal(label, null); assert.equal(query.period, 'monthly');
  });
  it('says so plainly when the terms cannot be loaded (503)', async () => {
    await assert.rejects(resolveTermQuery({ term: '2026-1S' }, { env, fetchImpl: async () => ({ ok: false }) }), (e) => e.status === 503 && /could not be loaded/.test(e.message));
  });
  it('own dates plus a term are refused', async () => {
    await assert.rejects(resolveTermQuery({ term: '2026-1S', from: '2026-01-01', to: '2026-01-31' }, { env, fetchImpl: fetchOk }), /not both/);
  });
});
