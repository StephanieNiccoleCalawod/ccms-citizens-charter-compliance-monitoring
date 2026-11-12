// Browser regression test for CC050 (Granted or Disapproved at Complete) and the CC027 change (K14: Executive read-only list and
// detail). A plain Playwright script like complete-manual-end.cjs: it needs only the frontend at BASE_URL (npm run dev). Every
// /api call is MOCKED with page routes and the session is a fake token, so no backend, credentials, transactions or audit records
// are involved. All data is synthetic.
//
// Run:  node tests/e2e/cc050-cc027.cjs
const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TID = '55555555-5555-4555-8555-555555555555';
const OFFICE = '11111111-1111-4111-8111-111111111111';
const OFFICE_B = '66666666-6666-4666-8666-666666666666';

const ok = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (r, status, code, message = 'x', details = null) => json(r, status, { error: { code, message, details, correlation_id: 'c', timestamp: 't' } });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (role) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', employee_no: 'E1', full_name: 'E2E Tester', role, office_id: role === 'super_admin' || role === 'executive' ? null : OFFICE })}.e2e`;

// The operator's view of an open transaction (synthetic).
const tx = (o = {}) => ({ transaction_id: TID, tracking_no: 'CAMP-ADMIN-20261020-0009', service_name: 'Issuance of Clearance', service_code: 'CAMP-ADMIN-CLR-001', office_id: OFFICE, office_code: 'CAMP-ADMIN', standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, client_type: 'STUDENT', status: 'IN_PROGRESS', started_at: '2026-10-20T01:00:00.000Z', ended_at: null, elapsed_working_minutes: null, is_compliant: null, variance_minutes: null, is_backdated: false, held_minutes: 0, hold_started_at: null, outcome: null, started_by_name: 'Synthetic Officer', started_by_position: 'Clerk', counter_label: 'Window 9', version: 1, ...o });
// What Operations sends an Executive: the allowlist only (no staff, client contact, registry, counter or reason fields).
const execTx = (o = {}) => ({ transaction_id: TID, tracking_no: 'CAMP-ADMIN-20261020-0009', service_id: 's1', service_code: 'CAMP-ADMIN-CLR-001', service_name: 'Issuance of Clearance', service_classification: 'SIMPLE', office_id: OFFICE, office_code: 'CAMP-ADMIN', office_name: 'Administration', standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, client_type: 'STUDENT', status: 'COMPLETED', outcome: 'DISAPPROVED', started_at: '2026-10-20T01:00:00.000Z', ended_at: '2026-10-20T01:45:00.000Z', hold_started_at: null, held_minutes: 0, elapsed_working_minutes: 45, is_compliant: true, variance_minutes: -15, is_backdated: false, started_outside_hours: false, version: 3, ...o });

async function mocked(browser, role, { complete, path = `/transactions/${TID}`, detail = role === 'executive' ? execTx() : tx() } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1400 } });
  const page = await ctx.newPage();
  const log = { completes: [], writes: [], counters: 0, lists: [] };
  const state = { tx: detail };
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/api/identity/auth/refresh') return json(r, 200, { access_token: fakeJwt(role), expires_in: 900 });
    if (p === '/api/operations/settings') return json(r, 200, { hold_enabled: true, counters_enabled: true, version: 1 });
    if (p === '/api/operations/counters') { log.counters += 1; return json(r, 200, { items: [{ counter_id: 'c1', label: 'Window 9', is_active: true }] }); }
    if (p.startsWith('/api/catalogue/services')) return json(r, 200, { items: [], total: 0 });
    if (p.startsWith('/api/catalogue/offices')) return json(r, 200, { items: [{ office_id: OFFICE, office_name: 'Administration', is_active: true }, { office_id: OFFICE_B, office_name: 'Academic Affairs', is_active: true }] });
    if (p === '/api/operations/transactions' && req.method() === 'GET') { log.lists.push(url.search); return json(r, 200, { items: [state.tx, { ...state.tx, transaction_id: '77777777-7777-4777-8777-777777777777', tracking_no: 'ACAD-20261020-0001', office_id: OFFICE_B, office_code: 'ACAD', status: 'IN_PROGRESS', outcome: null, ended_at: null, is_compliant: null }], page: 1, page_size: 20, total: 2 }); }
    if (p === `/api/operations/transactions/${TID}` && req.method() === 'GET') return json(r, 200, state.tx);
    if (p === `/api/operations/transactions/${TID}/complete`) { const body = req.postData() ? req.postDataJSON() : null; log.completes.push(body); return complete(r, state, body); }
    if (req.method() !== 'GET') { log.writes.push(`${req.method()} ${p}`); return apiError(r, 403, 'FORBIDDEN'); }
    return json(r, 404, { error: { code: 'NOT_MOCKED', message: p } });
  });
  await ctx.addCookies([{ name: 'ccms_signed_in', value: '1', url: BASE }]);
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 90000 });
  return { page, ctx, log, state };
}
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const openDialog = async (page) => { await page.getByTestId('tracking-no').waitFor({ timeout: 60000 }); await btn(page, 'Complete Transaction').click(); await page.getByRole('alertdialog').waitFor(); };
const finish = (r, s, body) => { s.tx = tx({ status: 'COMPLETED', ended_at: '2026-10-20T01:45:00.000Z', elapsed_working_minutes: 45, is_compliant: true, variance_minutes: -15, outcome: body?.outcome ?? null }); return json(r, 200, s.tx); };

(async () => {
  const browser = await chromium.launch();

  // CC050: nothing chosen -> refused before sending.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: finish });
    await openDialog(page);
    ok('CC050: Granted and Disapproved are offered, neither is preselected', (await page.locator('#complete-outcome-granted').isChecked()) === false && (await page.locator('#complete-outcome-disapproved').isChecked()) === false);
    await btn(page, 'Confirm').click();
    await page.locator('#complete-outcome-error').waitFor();
    ok('CC050: Confirm without a choice shows "Choose Granted or Disapproved" and sends nothing', /Choose Granted or Disapproved/.test(await page.locator('#complete-outcome-error').innerText()) && log.completes.length === 0);
    await ctx.close();
  }

  // CC050: Granted needs no reason or tick.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: finish });
    await openDialog(page);
    await page.check('#complete-outcome-granted');
    ok('CC050: Granted shows no reason box and no notice tick', (await page.locator('#complete-disapproval-reason').count()) === 0 && (await page.locator('#complete-disapproval-notice').count()) === 0);
    await btn(page, 'Confirm').click();
    await page.getByTestId('outcome').waitFor();
    ok('CC050: Granted sends { outcome: GRANTED } only and the detail shows "Granted"', JSON.stringify(log.completes) === JSON.stringify([{ outcome: 'GRANTED' }]) && (await page.getByTestId('outcome').innerText()).includes('Granted'));
    await ctx.close();
  }

  // CC050: Disapproved, each field missing, then valid; switching resets the hidden fields.
  {
    const { page, ctx, log } = await mocked(browser, 'office_head', { complete: finish });
    await openDialog(page);
    await page.check('#complete-outcome-disapproved');
    await btn(page, 'Confirm').click();
    await page.locator('#complete-disapproval-reason-error').waitFor();
    ok('CC050: Disapproved with nothing filled names the reason and the tick, nothing sent', (await page.locator('#complete-disapproval-notice-error').count()) === 1 && log.completes.length === 0);
    await page.fill('#complete-disapproval-reason', '   ');
    await page.check('#complete-disapproval-notice');
    await btn(page, 'Confirm').click();
    await page.locator('#complete-disapproval-reason-error').waitFor();
    ok('CC050: a whitespace-only reason is refused, nothing sent', log.completes.length === 0);
    ok('CC050: the reason box stops at 1,000 characters', (await page.locator('#complete-disapproval-reason').getAttribute('maxlength')) === '1000');
    await page.fill('#complete-disapproval-reason', 'Synthetic reason typed then hidden');
    await page.check('#complete-outcome-granted');
    await page.check('#complete-outcome-disapproved');
    ok('CC050: switching to Granted and back clears the reason and the tick', (await page.locator('#complete-disapproval-reason').inputValue()) === '' && (await page.locator('#complete-disapproval-notice').isChecked()) === false);
    await page.fill('#complete-disapproval-reason', '  Synthetic missing signature  ');
    await btn(page, 'Confirm').click();
    await page.locator('#complete-disapproval-notice-error').waitFor();
    ok('CC050: a reason without the tick is refused, nothing sent', log.completes.length === 0);
    await page.check('#complete-disapproval-notice');
    await btn(page, 'Confirm').click();
    await page.getByTestId('outcome').waitFor();
    ok('CC050: a valid Disapproved sends the outcome, the trimmed reason and the tick', JSON.stringify(log.completes) === JSON.stringify([{ outcome: 'DISAPPROVED', disapproval_reason: 'Synthetic missing signature', disapproval_notice_given: true }]));
    ok('CC050: the detail shows "Disapproved" and not the reason text', (await page.getByTestId('outcome').innerText()).includes('Disapproved') && !/Synthetic missing signature/.test(await page.locator('body').innerText()));
    await ctx.close();
  }

  // CC050: the server names a field -> shown next to it; the dialog stays open.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: (r) => apiError(r, 400, 'VALIDATION_ERROR', 'x', { disapproval_notice_given: 'Confirm that the client was given written notice of the disapproval' }) });
    await openDialog(page);
    await page.check('#complete-outcome-disapproved');
    await page.fill('#complete-disapproval-reason', 'Synthetic reason');
    await page.check('#complete-disapproval-notice');
    await btn(page, 'Confirm').click();
    await page.locator('#complete-disapproval-notice-error').waitFor();
    ok('CC050: a server 400 is shown at the named field, dialog open, still In progress', /written notice/.test(await page.locator('#complete-disapproval-notice-error').innerText()) && (await page.getByRole('alertdialog').count()) === 1 && (await page.getByTestId('status').innerText()) === 'In progress' && log.completes.length === 1);
    await ctx.close();
  }

  // CC050: an old completion shows "Not recorded"; an open one shows no outcome.
  {
    const { page, ctx } = await mocked(browser, 'office_head', { detail: tx({ status: 'COMPLETED', ended_at: '2026-10-20T01:45:00.000Z', is_compliant: true, elapsed_working_minutes: 45, variance_minutes: -15, outcome: null }) });
    await page.getByTestId('outcome').waitFor({ timeout: 60000 });
    ok('CC050: an old completion reads "Not recorded"', (await page.getByTestId('outcome').innerText()).includes('Not recorded'));
    await ctx.close();
  }
  {
    const { page, ctx } = await mocked(browser, 'office_head', {});
    await page.getByTestId('tracking-no').waitFor({ timeout: 60000 });
    ok('CC050: an in-progress transaction shows no outcome; Cancel is still its own button', (await page.getByTestId('outcome').count()) === 0 && (await btn(page, 'Cancel Transaction').count()) === 1);
    await ctx.close();
  }

  // CC027 (K14): Executive detail, read-only.
  {
    const { page, ctx, log } = await mocked(browser, 'executive', { complete: finish });
    await page.getByTestId('tracking-no').waitFor({ timeout: 60000 });
    const text = await page.locator('body').innerText();
    ok('K14: the Executive opens the detail and sees the outcome', (await page.getByTestId('outcome').innerText()).includes('Disapproved'));
    ok('K14: no Complete, Hold, Resume, Cancel or Print acknowledgement', (await btn(page, 'Complete Transaction').count()) === 0 && (await btn(page, 'Hold').count()) === 0 && (await btn(page, 'Resume').count()) === 0 && (await btn(page, 'Cancel Transaction').count()) === 0 && (await page.getByTestId('acknowledgement-link').count()) === 0);
    ok('K14: no Started by, registry or counter section', (await page.getByTestId('started-by').count()) === 0 && (await page.getByTestId('registry').count()) === 0 && !/Counter/.test(text));
    ok('K14: nothing was written', log.writes.length === 0 && log.completes.length === 0);
    await ctx.close();
  }

  // CC027 (K14): Executive list, read-only, across offices.
  {
    const { page, ctx, log } = await mocked(browser, 'executive', { path: `/transactions?counter_id=c1&office_id=${OFFICE_B}` });
    await page.getByTestId('tx-row').first().waitFor({ timeout: 60000 });
    ok('K14: the Transactions menu item is shown to the Executive', (await page.getByRole('link', { name: 'Transactions', exact: true }).count()) >= 1);
    ok('K14: no Add Transaction button, no Counter column or filter, and counters are never requested', (await page.getByTestId('add-transaction').count()) === 0 && (await page.getByRole('columnheader', { name: 'Counter' }).count()) === 0 && (await page.locator('#tx-counter').count()) === 0 && log.counters === 0);
    ok('K14: the Office filter is offered, and a counter filter from the address is dropped', (await page.locator('#tx-office').count()) === 1 && log.lists.every((q) => !/counter_id/.test(q)) && log.lists.some((q) => q.includes(`office_id=${OFFICE_B}`)));
    ok('K14: rows from two offices are listed, the completed one with its outcome', (await page.getByTestId('tx-row').count()) === 2 && (await page.getByTestId('tx-outcome').first().innerText()).includes('Disapproved'));
    await page.getByRole('button', { name: /View details of CAMP-ADMIN/ }).click();
    await page.getByRole('dialog').getByTestId('tracking-no').waitFor();
    ok('K14: the details modal is read-only too', (await page.getByRole('dialog').getByRole('button', { name: 'Complete Transaction' }).count()) === 0 && (await page.getByRole('dialog').getByTestId('acknowledgement-link').count()) === 0);
    await ctx.close();
  }

  // CC027 (K14): the acknowledgement slip and the start page stay closed to the Executive.
  for (const path of [`/transactions/${TID}/acknowledgement`, '/transactions/new']) {
    const { page, ctx, log } = await mocked(browser, 'executive', { path });
    await page.getByText('Your role does not have access to this page.').waitFor({ timeout: 60000 });
    ok(`K14: ${path} is still refused to the Executive`, log.writes.length === 0);
    await ctx.close();
  }

  // Other roles are unchanged.
  {
    const { page, ctx } = await mocked(browser, 'office_head', { path: '/transactions' });
    await page.getByTestId('tx-row').first().waitFor({ timeout: 60000 });
    ok('operators still get Add Transaction and the Counter column', (await page.getByTestId('add-transaction').count()) === 1 && (await page.getByRole('columnheader', { name: 'Counter' }).count()) === 1);
    await ctx.close();
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
