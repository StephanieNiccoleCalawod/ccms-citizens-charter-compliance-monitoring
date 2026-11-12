import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ComplaintApiError, fileComplaint, getComplaintStatus, listPublicOffices } from '../../src/lib/api/complaints.js';
import { CATEGORIES, EMPTY_FORM, describeFailure, formErrors, normalizeReference, privacyNoticeUrl, referenceError, remaining, statusLabel } from '../../src/lib/ui/complaints.js';

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const okForm = { ...EMPTY_FORM, office_id: 'o1', category: 'OTHER', description: 'Something happened.' };
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });

describe('complaint form rules', () => {
  it('needs office, category and description (AC1)', () => {
    assert.deepEqual(Object.keys(formErrors(EMPTY_FORM)).sort(), ['category', 'description', 'office_id']);
    assert.deepEqual(formErrors(okForm), {});
  });
  it('limits the description to 2000, and checks an optional email only when given', () => {
    assert.ok(formErrors({ ...okForm, description: 'x'.repeat(2001) }).description);
    assert.equal(remaining({ description: 'x'.repeat(10) }), 1990);
    assert.ok(formErrors({ ...okForm, email: 'nope' }).email);
    assert.deepEqual(formErrors({ ...okForm, email: 'a@b.co', name: 'Ana', tracking_no: 'T-1' }), {});
  });
  it('the categories match the service’s list exactly (AC5)', () => {
    const source = readFileSync(new URL('../../../oversight-service/src/modules/complaints/complaints.js', import.meta.url), 'utf8');
    const fromService = [...source.matchAll(/\{ value: '([A-Z_]+)', label: '([^']+)' \}/g)].map((m) => m[1]);
    assert.deepEqual(CATEGORIES.map((c) => c.value), fromService);
    assert.ok(CATEGORIES.some((c) => c.value === 'OTHER'));
  });
  it('normalises a typed reference and explains failures', () => {
    assert.equal(normalizeReference(' cmp-20261113-ab cdef '), 'CMP-20261113-ABCDEF');
    assert.ok(referenceError('  '));
    assert.equal(referenceError('x'), '');
    assert.deepEqual(describeFailure({ status: 400, details: { office_id: 'Choose an active office.' } }).fields, { office_id: 'Choose an active office.' });
    assert.match(describeFailure({ status: 503 }).message, /try again later/);
    assert.match(describeFailure({ status: 429, message: 'Slow down' }).message, /Slow down/);
    assert.equal(statusLabel('RECEIVED'), 'Received');
  });
  it('shows a privacy link only when one is configured', () => {
    assert.equal(privacyNoticeUrl({}), '');
    assert.equal(privacyNoticeUrl({ NEXT_PUBLIC_PRIVACY_NOTICE_URL: 'javascript:alert(1)' }), '');
    assert.equal(privacyNoticeUrl({ NEXT_PUBLIC_PRIVACY_NOTICE_URL: 'https://pup.edu.ph/privacy' }), 'https://pup.edu.ph/privacy');
  });
});

describe('complaint API client', () => {
  it('posts to the logs route without a token and leaves empty optional fields out', async () => {
    let call;
    const out = await fileComplaint({ ...okForm, name: ' ', email: ' a@b.co ' }, async (url, init) => { call = { url, init }; return reply(201, { reference: 'CMP-20261113-ABCDEF', status: 'RECEIVED', email_sent: true }); });
    assert.equal(call.url, '/api/logs/complaints');
    assert.equal(call.init.method, 'POST');
    assert.ok(!('authorization' in call.init.headers));
    assert.deepEqual(JSON.parse(call.init.body), { office_id: 'o1', category: 'OTHER', description: 'Something happened.', email: 'a@b.co' });
    assert.equal(out.reference, 'CMP-20261113-ABCDEF');
  });
  it('keeps the field details of a 400 and explains a 429', async () => {
    await assert.rejects(fileComplaint(okForm, async () => reply(400, { error: { message: 'Fix', code: 'VALIDATION_ERROR', details: { email: 'bad' } } })), (e) => e instanceof ComplaintApiError && e.status === 400 && e.details.email === 'bad');
    await assert.rejects(fileComplaint(okForm, async () => reply(429, { error: { message: 'Too many' } }, { 'retry-after': '1800' })), (e) => e.status === 429 && /30 minutes/.test(e.message));
    await assert.rejects(fileComplaint(okForm, async () => { throw new Error('offline'); }), (e) => /Cannot reach/.test(e.message));
  });
  it('asks for a status with the reference in the query and reads a 404', async () => {
    let url;
    assert.deepEqual(await getComplaintStatus('CMP-1', async (u) => { url = u; return reply(200, { reference: 'CMP-1', status: 'RECEIVED' }); }), { reference: 'CMP-1', status: 'RECEIVED' });
    assert.equal(url, '/api/logs/complaints/status?ref=CMP-1');
    await assert.rejects(getComplaintStatus('CMP-X', async () => reply(404, { error: { code: 'COMPLAINT_NOT_FOUND', message: 'nf' } })), (e) => e.status === 404 && e.code === 'COMPLAINT_NOT_FOUND');
  });
  it('lists the public offices', async () => {
    assert.deepEqual(await listPublicOffices(async (p) => { assert.equal(p, '/api/catalogue/public/offices'); return { items: [{ office_id: 'o1' }] }; }), [{ office_id: 'o1' }]);
  });
});

describe('complaint pages', () => {
  it('are public: no app shell, no sign-in', () => {
    for (const p of ['components/complaints/ComplaintForm.js', 'components/complaints/ComplaintStatus.js', 'app/complaint/page.js', 'app/complaint/status/page.js']) {
      const text = read(p);
      assert.doesNotMatch(text, /AppShell|apiFetch|getAccessToken/, p);
    }
  });
  it('say "complaint" and never ask for an officer’s name (C-07)', () => {
    const text = read('components/complaints/ComplaintForm.js') + read('components/complaints/ComplaintStatus.js');
    assert.doesNotMatch(text, /\bofficers?\b/i);
    assert.match(text, /Submit complaint/);
  });
  it('the public header links to the form', () => {
    assert.match(read('components/layout/PublicHeader.js'), /href="\/complaint"/);
  });
});
