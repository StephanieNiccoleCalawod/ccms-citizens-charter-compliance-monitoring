// Browser regression test for completing an open transaction, with and without an end time entered by hand (CC023/CC026).
// A plain Playwright script like smoke.cjs (no test runner). It needs only the frontend at BASE_URL (npm run dev): every
// /api call is MOCKED with page routes and the session is a fake token, so no backend, credentials, transactions or audit
// records are involved, and nothing real is completed. Any /api call that is not mocked fails the run.
//
// Run:  node tests/e2e/complete-manual-end.cjs
const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TID = '44444444-4444-4444-8444-444444444444';
const OFFICE = '11111111-1111-4111-8111-111111111111';

const ok = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (r, status, code, message = 'x', details = null) => json(r, status, { error: { code, message, details, correlation_id: 'c', timestamp: 't' } });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (role) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', employee_no: 'E1', full_name: 'E2E Tester', role, office_id: role === 'super_admin' || role === 'executive' ? null : OFFICE })}.e2e`;

// The server's transaction, started 9:00 AM Manila on 10/20/2026.
const tx = (o = {}) => ({ transaction_id: TID, tracking_no: 'CAMP-ADMIN-20261020-0001', service_name: 'Issuance of Clearance', service_code: 'CAMP-ADMIN-CLR-001', office_code: 'CAMP-ADMIN', standard_duration_days: 0, standard_duration_hours: 1, standard_duration_minutes: 0, client_type: 'STUDENT', status: 'IN_PROGRESS', started_at: '2026-10-20T01:00:00.000Z', ended_at: null, elapsed_working_minutes: null, is_compliant: null, variance_minutes: null, is_backdated: false, backdate_reason: null, held_minutes: 0, hold_started_at: null, hold_reason: null, cancel_reason: null, version: 1, ...o });

async function mocked(browser, role, { complete } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1400 } });
  const page = await ctx.newPage();
  const log = { completes: [], gets: 0, unmocked: [] };
  const state = { tx: tx(), failGets: false };
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/identity/auth/refresh') return json(r, 200, { access_token: fakeJwt(role), expires_in: 900 });
    if (path === '/api/operations/settings') return json(r, 200, { hold_enabled: true, counters_enabled: false, version: 1 });
    if (path === `/api/operations/transactions/${TID}` && req.method() === 'GET') { log.gets += 1; return state.failGets ? r.abort('connectionrefused') : json(r, 200, state.tx); }
    if (path === `/api/operations/transactions/${TID}/complete`) { log.completes.push(req.postData() ? req.postDataJSON() : null); return complete(r, state, req.postData() ? req.postDataJSON() : null); }
    log.unmocked.push(`${req.method()} ${path}`);
    return json(r, 404, { error: { code: 'NOT_MOCKED', message: path } });
  });
  await ctx.addCookies([{ name: 'ccms_signed_in', value: '1', url: BASE }]);
  await page.goto(`${BASE}/transactions/${TID}`, { waitUntil: 'load', timeout: 90000 });
  if (role !== 'executive') await page.getByTestId('tracking-no').waitFor({ timeout: 60000 });
  return { page, ctx, log, state };
}
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const openDialog = async (page) => { await btn(page, 'Complete Transaction').click(); await page.getByRole('alertdialog').waitFor(); };
// What the service would answer (mocked): the page only displays it.
const finish = (extra = {}) => (r, s, body) => { s.tx = tx({ status: 'COMPLETED', ended_at: body?.ended_at ? '2026-10-20T01:45:00.000Z' : '2026-10-24T03:00:00.000Z', is_backdated: Boolean(body), backdate_reason: body?.backdate_reason ?? null, ...extra }); return json(r, 200, s.tx); };

(async () => {
  const browser = await chromium.launch();

  // Ordinary completion is unchanged: no body, no manual fields until asked.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: finish({ elapsed_working_minutes: 30, is_compliant: true, variance_minutes: -30 }) });
    await openDialog(page);
    ok('ordinary: the dialog still explains the end time and compliance and shows only the option, collapsed', /records the end time/.test(await page.getByRole('alertdialog').innerText()) && (await page.locator('#complete-manual-end').count()) === 1 && (await page.locator('#complete-end').count()) === 0);
    await btn(page, 'Cancel').click();
    ok('ordinary: Cancel sends nothing', log.completes.length === 0);
    await openDialog(page);
    await btn(page, 'Confirm').click();
    await page.getByTestId('compliance-label').waitFor();
    ok('ordinary: exactly one POST with no body, then Completed and Compliant from the server', log.completes.length === 1 && log.completes[0] === null && (await page.getByTestId('status').innerText()) === 'Completed' && (await page.getByTestId('compliance-label').innerText()) === 'Compliant');
    ok('ordinary: not shown as entered after the fact', (await page.getByTestId('backdated').count()) === 0);
    await ctx.close();
  }

  // Manual end: success, payload, server-returned values.
  for (const [label, extra, expectLabel] of [['Compliant', { elapsed_working_minutes: 45, is_compliant: true, variance_minutes: -15 }, 'Compliant'], ['Breach', { elapsed_working_minutes: 90, is_compliant: false, variance_minutes: 30 }, 'Breach'], ['pending', {}, 'Pending computation']]) {
    const { page, ctx, log } = await mocked(browser, 'office_head', { complete: finish(extra) });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', '  Finished earlier, recorded now  ');
    await btn(page, 'Confirm').click();
    await page.getByTestId('compliance-label').waitFor();
    ok(`manual end (${label}): one POST with exactly { ended_at (+08:00), backdate_reason (trimmed) }`, log.completes.length === 1 && JSON.stringify(log.completes[0]) === JSON.stringify({ ended_at: '2026-10-20T09:45:00+08:00', backdate_reason: 'Finished earlier, recorded now' }));
    ok(`manual end (${label}): shows ${expectLabel}, Completed, the server's end time, the flag and the reason`, (await page.getByTestId('compliance-label').innerText()) === expectLabel && (await page.getByTestId('status').innerText()) === 'Completed' && (await page.getByTestId('ended-at').innerText()).includes('10/20/2026 9:45 AM') && (await page.getByTestId('backdated').innerText()).startsWith('Yes') && /Finished earlier/.test(await page.getByTestId('backdate-reason').innerText()));
    await ctx.close();
  }

  // Invalid input: nothing is sent.
  const bad = [
    ['end equal to the start', { end: '2026-10-20T09:00', reason: 'r' }, '#complete-end-error', /after the time the transaction started/],
    ['end before the start', { end: '2026-10-20T08:00', reason: 'r' }, '#complete-end-error', /after the time the transaction started/],
    ['end in the future', { end: '2099-01-01T09:00', reason: 'r' }, '#complete-end-error', /cannot be in the future/],
    ['missing end', { end: '', reason: 'r' }, '#complete-end-error', /Enter when the transaction ended/],
    ['missing reason', { end: '2026-10-20T09:45', reason: '' }, '#complete-end-reason-error', /Enter why/],
    ['whitespace-only reason', { end: '2026-10-20T09:45', reason: '   ' }, '#complete-end-reason-error', /Enter why/],
  ];
  for (const [name, input, selector, text] of bad) {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: finish() });
    await openDialog(page);
    await page.check('#complete-manual-end');
    if (input.end) await page.fill('#complete-end', input.end);
    if (input.reason) await page.fill('#complete-end-reason', input.reason);
    await btn(page, 'Confirm').click();
    await page.locator(selector).waitFor();
    ok(`invalid (${name}): message shown, dialog stays open, nothing sent`, text.test(await page.locator(selector).innerText()) && (await page.getByRole('alertdialog').count()) === 1 && log.completes.length === 0);
    await ctx.close();
  }

  // Switching the option off returns to the ordinary request.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: finish() });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.uncheck('#complete-manual-end');
    await btn(page, 'Confirm').click();
    await page.getByTestId('status').filter({ hasText: 'Completed' }).waitFor();
    ok('switching the option off sends an ordinary completion (no body)', log.completes.length === 1 && log.completes[0] === null);
    await ctx.close();
  }

  // Duplicate clicks.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: async (r, s, b) => { await new Promise((x) => setTimeout(x, 800)); return finish()(r, s, b); } });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', 'r');
    await btn(page, 'Confirm').click();
    await page.getByRole('button', { name: 'Completing…' }).click({ force: true, timeout: 400 }).catch(() => {});
    await page.getByTestId('compliance-label').waitFor();
    ok('duplicate clicks: exactly one request', log.completes.length === 1);
    await ctx.close();
  }

  // The service refuses the typed times (400): the dialog stays open on the named fields.
  {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete: (r) => apiError(r, 400, 'VALIDATION_ERROR', 'x', { ended_at: 'End must be after start', backdate_reason: 'Enter why this time is entered after the fact' }) });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', 'r');
    await btn(page, 'Confirm').click();
    await page.locator('#complete-end-error').waitFor();
    ok('service 400: its messages show next to the fields; dialog open; the transaction is still In progress', /End must be after start/.test(await page.locator('#complete-end-error').innerText()) && /Enter why/.test(await page.locator('#complete-end-reason-error').innerText()) && (await page.getByRole('alertdialog').count()) === 1 && (await page.getByTestId('status').innerText()) === 'In progress' && log.completes.length === 1);
    await ctx.close();
  }

  // 403, 409, 401 and server errors.
  const failures = [
    ['403', (r) => apiError(r, 403, 'FORBIDDEN', 'x at /srv/a.js'), /do not have permission to complete/, 'In progress', true],
    ['409 already completed', (r, s) => { s.tx = tx({ status: 'COMPLETED', ended_at: '2026-10-20T01:30:00.000Z', elapsed_working_minutes: 30, is_compliant: true, variance_minutes: -30 }); return apiError(r, 409, 'INVALID_STATE', 'x', { status: 'COMPLETED' }); }, /already completed/, 'Completed', false],
    ['409 put on hold meanwhile', (r, s) => { s.tx = tx({ status: 'ON_HOLD', hold_started_at: '2026-10-20T02:00:00.000Z', hold_reason: 'r' }); return apiError(r, 409, 'INVALID_STATE', 'x', { status: 'ON_HOLD' }); }, /Resume it before completing/, 'On hold', false],
    ['500 (unclear), not applied', (r) => apiError(r, 500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'), /not completed. You can try again/, 'In progress', true],
    ['500 (unclear), but it was saved', (r, s) => { s.tx = tx({ status: 'COMPLETED', ended_at: '2026-10-20T01:45:00.000Z', is_backdated: true, backdate_reason: 'r' }); return apiError(r, 500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'); }, /The transaction was completed/, 'Completed', false],
    ['network failure, not applied', (r) => r.abort('connectionrefused'), /not completed. You can try again/, 'In progress', true],
  ];
  for (const [name, complete, text, status, again] of failures) {
    const { page, ctx, log } = await mocked(browser, 'office_staff', { complete });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', 'r');
    await btn(page, 'Confirm').click();
    await page.getByText(text).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    ok(`manual end, ${name}: safe message, state read back (${status}), one request, Complete ${again ? 'offered again' : 'gone'}`, (await page.getByTestId('status').innerText()) === status && log.completes.length === 1 && ((await btn(page, 'Complete Transaction').count()) === 1) === again && !/pg\.js|TypeError|srv/.test(await page.locator('body').innerText()));
    await ctx.close();
  }
  {
    const { page, ctx } = await mocked(browser, 'office_staff', { complete: (r) => apiError(r, 401, 'UNAUTHORIZED') });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', 'r');
    await btn(page, 'Confirm').click();
    await page.waitForURL(/\/login/, { timeout: 30000 });
    ok('manual end, 401: sent to sign in (existing client behaviour)', true);
    await ctx.close();
  }

  // Success but the read-back fails: nothing can be resubmitted until the status is checked.
  {
    const { page, ctx, log, state } = await mocked(browser, 'office_head', { complete: (r, s, b) => { s.failGets = true; return finish({ elapsed_working_minutes: 45, is_compliant: true, variance_minutes: -15 })(r, s, b); } });
    await openDialog(page);
    await page.check('#complete-manual-end');
    await page.fill('#complete-end', '2026-10-20T09:45');
    await page.fill('#complete-end-reason', 'r');
    await btn(page, 'Confirm').click();
    await page.getByRole('button', { name: 'Check status', exact: true }).waitFor({ timeout: 15000 });
    ok('failed read-back: Complete, Hold and Cancel are withdrawn; only Check status is offered', (await btn(page, 'Complete Transaction').count()) === 0 && (await btn(page, 'Hold').count()) === 0 && (await btn(page, 'Cancel Transaction').count()) === 0 && log.completes.length === 1);
    state.failGets = false;
    await btn(page, 'Check status').click();
    await page.getByTestId('compliance-label').waitFor();
    ok('failed read-back: Check status shows the saved result from the server; still one completion', (await page.getByTestId('status').innerText()) === 'Completed' && (await page.getByTestId('ended-at').innerText()).includes('9:45 AM') && log.completes.length === 1);
    await ctx.close();
  }

  // Other flows are unchanged.
  {
    const { page, ctx, log } = await mocked(browser, 'office_head', { complete: finish() });
    ok('office head still sees Hold, Complete Transaction and Cancel Transaction', (await btn(page, 'Hold').count()) === 1 && (await btn(page, 'Complete Transaction').count()) === 1 && (await btn(page, 'Cancel Transaction').count()) === 1);
    await btn(page, 'Cancel Transaction').click();
    await page.getByRole('dialog').waitFor();
    ok('the cancel dialog is unchanged (reason box, no manual end)', (await page.locator('#cancel-reason-input').count()) === 1 && (await page.locator('#complete-manual-end').count()) === 0);
    await page.keyboard.press('Escape');
    ok('nothing was sent while looking at the dialogs', log.completes.length === 0);
    await ctx.close();
  }
  {
    const { page, ctx } = await mocked(browser, 'office_staff', { complete: finish() });
    ok('office staff still sees Complete but not Cancel (role visibility unchanged)', (await btn(page, 'Complete Transaction').count()) === 1 && (await btn(page, 'Cancel Transaction').count()) === 0);
    await ctx.close();
  }
  {
    const { page, ctx, log } = await mocked(browser, 'executive', { complete: finish() });
    await page.getByText('Your role does not have access to this page.').waitFor({ timeout: 60000 });
    ok('executive is still denied: no request to Operations', log.gets === 0 && log.completes.length === 0);
    await ctx.close();
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
