// Browser smoke test (plain Playwright script, no test runner). Playwright is a devDependency; the
// browser comes from:  npx playwright install chromium
//
// 1. Logout checks (always run). Need only the frontend at BASE_URL (npm run dev). Every /api call is
//    mocked with page routes and the session is a fake, unsigned token planted in sessionStorage, so
//    no credentials, Identity, Core or sample data are used. Any /api call that is not mocked fails.
// 2. Full-system smoke (runs when ADMIN_PASSWORD is set). Needs the whole system running, the Super
//    Admin from ccms-identity-service/.env.local and sample data loaded.
//
// Run:  node tests/e2e/smoke.cjs                                   (logout checks only)
//       ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/smoke.cjs  (both)
const { chromium } = require('playwright');
const OUT = process.env.OUT_DIR || '.';
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const ok = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };

// ---------------------------------------------------------------------------------------------------
// 1. Logout checks with mocked endpoints
// ---------------------------------------------------------------------------------------------------

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// The browser only decodes the claims for display; nothing verifies this signature in these checks.
const fakeJwt = (role) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'e2e-user', employee_no: 'E2E-1', full_name: 'E2E Tester', role, office_id: null })}.e2e`;

/**
 * A page with mocked /api routes.
 *   seedRole: plant a signed-in session with this role (null: none)
 *   logout:   queue of answers for POST /api/identity/auth/logout: 'ok' | 500 | 'abort' | { delay, then }
 *   refreshRole: role in the token returned by POST /api/identity/auth/refresh (null: 401)
 */
async function mockedPage(browser, { viewport = DESKTOP, seedRole = 'super_admin', logout = [], refreshRole = null } = {}) {
  const ctx = await browser.newContext({ viewport });
  const calls = { logout: 0, refresh: 0, bearer: [], unmocked: [] };
  const errors = [];

  if (seedRole) {
    await ctx.addCookies([{ name: 'ccms_signed_in', value: '1', url: BASE }]);
    // Seed once per tab: later full-page loads (the sign-out redirect) must see what the app left.
    await ctx.addInitScript((token) => {
      if (sessionStorage.getItem('__e2e_seeded')) return;
      sessionStorage.setItem('__e2e_seeded', '1');
      sessionStorage.setItem('ccms_access', JSON.stringify({ token, expiresAt: Date.now() + 10 * 60_000 }));
    }, fakeJwt(seedRole));
  }

  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.headers().authorization) calls.bearer.push(pathname);
    if (request.method() === 'POST' && pathname === '/api/identity/auth/logout') {
      calls.logout += 1;
      let answer = logout.shift() ?? 'ok';
      if (answer && typeof answer === 'object') {
        await new Promise((r) => setTimeout(r, answer.delay));
        answer = answer.then;
      }
      if (answer === 'abort') return route.abort('connectionrefused');
      if (answer === 'ok') return route.fulfill({ status: 204 });
      return json(route, answer, { error: { code: 'INTERNAL', message: 'mocked failure' } });
    }
    if (request.method() === 'POST' && pathname === '/api/identity/auth/refresh') {
      calls.refresh += 1;
      if (!refreshRole) return json(route, 401, { error: { code: 'UNAUTHORIZED', message: 'No session' } });
      return json(route, 200, { access_token: fakeJwt(refreshRole), expires_in: 900 });
    }
    if (request.method() === 'GET' && pathname === '/api/catalogue/offices') return json(route, 200, { items: [] });
    if (request.method() === 'GET' && pathname === '/api/catalogue/public/services') return json(route, 200, { items: [], total: 0 });
    calls.unmocked.push(`${request.method()} ${pathname}`);
    return json(route, 404, { error: { code: 'NOT_MOCKED', message: 'not mocked in smoke.cjs' } });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { ctx, page, calls, errors };
}

// Sign out lives in the header's account menu: the menu button (aria-label "Account menu for <name>",
// aria-haspopup="menu") opens a menu whose only item is "Sign out", and that item opens the confirmation.
// Focus goes back to the menu button, the control that opened Sign out, when the confirmation closes.
const accountMenu = (page) => page.locator('header').getByRole('button', { name: /^Account menu for / });
const signOutItem = (page) => page.getByRole('menuitem', { name: 'Sign out' });
const signOutDialog = (page) => page.getByRole('alertdialog', { name: 'Sign out?' });

/** Opens the account menu and chooses Sign out, as a person with a mouse does. */
async function openSignOut(page) {
  await accountMenu(page).click();
  await signOutItem(page).click();
}

async function focused(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    return {
      text: (a?.textContent ?? '').trim(),
      label: a?.getAttribute('aria-label') ?? '',
      role: a?.getAttribute('role') ?? '',
      inDialog: Boolean(a?.closest('[role="alertdialog"]')),
      inHeader: Boolean(a?.closest('header')),
    };
  });
}
const onAccountMenu = (state) => state.inHeader && state.label.startsWith('Account menu for ');

async function openShell(page) {
  await page.goto(BASE + '/offices');
  await accountMenu(page).waitFor({ timeout: 30_000 });
}

/** Runs one scenario in its own context; a thrown error is a FAIL, not the end of the run. */
async function scenario(browser, name, options, body) {
  const env = await mockedPage(browser, options);
  try {
    await body(env);
    ok(`[${name}] no unmocked /api calls${env.calls.unmocked.length ? ': ' + env.calls.unmocked.join(', ') : ''}`, env.calls.unmocked.length === 0);
    ok(`[${name}] no page errors${env.errors.length ? ': ' + env.errors.join(' | ') : ''}`, env.errors.length === 0);
  } catch (error) {
    ok(`[${name}] ${error.message.split('\n')[0]}`, false);
    await env.page.screenshot({ path: `${OUT}/e2e-logout-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  } finally {
    await env.ctx.close();
  }
}

async function logoutChecks(browser) {
  for (const [label, viewport] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
    await scenario(browser, `cancel+focus ${label}`, { viewport }, async ({ page, calls }) => {
      await openShell(page);
      await openSignOut(page);
      const dialog = signOutDialog(page);
      await dialog.waitFor();
      ok(`${label}: confirmation shows the default message`, await dialog.getByText('You will need to sign in again to use CCMS.').isVisible());
      ok(`${label}: focus starts on Cancel`, (await focused(page)).text === 'Cancel');
      let trapped = true;
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press('Tab');
        trapped &&= (await focused(page)).inDialog;
      }
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press('Shift+Tab');
        trapped &&= (await focused(page)).inDialog;
      }
      ok(`${label}: Tab and Shift+Tab stay inside the dialog`, trapped);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'hidden' });
      const after = await focused(page);
      ok(`${label}: Cancel closes and returns focus to the account menu that opened Sign out`, onAccountMenu(after));
      ok(`${label}: Cancel does not revoke (0 logout calls)`, calls.logout === 0);
    });

    await scenario(browser, `escape+enter ${label}`, { viewport }, async ({ page, calls }) => {
      await openShell(page);
      await openSignOut(page);
      await signOutDialog(page).waitFor();
      await page.keyboard.press('Escape');
      await signOutDialog(page).waitFor({ state: 'hidden' });
      ok(`${label}: Escape closes and returns focus to the account menu`, onAccountMenu(await focused(page)));
      await page.keyboard.press('Enter'); // the account menu has focus: Enter opens the menu, focus lands on Sign out
      await signOutItem(page).waitFor();
      const inMenu = await focused(page);
      ok(`${label}: Enter on the account menu opens it with focus on Sign out`, inMenu.role === 'menuitem' && inMenu.text === 'Sign out');
      await page.keyboard.press('Enter'); // Sign out has focus: Enter opens the confirmation again
      await signOutDialog(page).waitFor();
      await page.keyboard.press('Enter'); // focus is on Cancel: Enter cancels, never signs out
      await signOutDialog(page).waitFor({ state: 'hidden' });
      ok(`${label}: Enter on the focused Cancel cancels`, calls.logout === 0 && page.url().endsWith('/offices'));
    });
  }

  await scenario(browser, 'success+duplicate+busy', { logout: [{ delay: 1500, then: 'ok' }] }, async ({ page, calls }) => {
    await openShell(page);
    await openSignOut(page);
    const dialog = signOutDialog(page);
    await dialog.waitFor();
    // Three synchronous clicks on the confirm button: only one revocation may happen.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Sign out');
      button.click();
      button.click();
      button.click();
    });
    const busyButton = dialog.getByRole('button', { name: 'Signing out…' });
    await busyButton.waitFor();
    ok('busy: confirm shows "Signing out…" and both buttons are disabled', (await busyButton.isDisabled()) && (await dialog.getByRole('button', { name: 'Cancel' }).isDisabled()));
    await page.keyboard.press('Escape');
    ok('busy: Escape does not close the dialog', await dialog.isVisible());
    await page.waitForURL(BASE + '/login', { timeout: 15_000 });
    await page.locator('#email').waitFor();
    ok('success: lands on the sign-in page, not the public home page', new URL(page.url()).pathname === '/login' && (await page.locator('#password').isVisible()) && (await page.getByText(/could not confirm that your session was ended/).count()) === 0);
    ok('duplicate clicks: exactly one logout request', calls.logout === 1);
    const left = await page.evaluate(() => ({ token: sessionStorage.getItem('ccms_access'), marker: document.cookie.includes('ccms_signed_in=') }));
    ok('success: saved token and signed-in marker are cleared', left.token === null && !left.marker);
  });

  for (const [name, answers] of [['http 500', [500, 500]], ['network abort', ['abort', 'abort']]]) {
    await scenario(browser, `failure ${name}`, { logout: answers }, async ({ page, calls }) => {
      await openShell(page);
      await openSignOut(page);
      await signOutDialog(page).getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
      const banner = page.getByRole('alert').filter({ hasText: 'could not confirm that your session was ended' });
      await banner.waitFor({ timeout: 15_000 });
      ok(`${name}: failure notice shown after the full-page redirect and the retry`, true);
      ok(`${name}: the sign-in page retried once (2 logout requests)`, calls.logout === 2);
      ok(`${name}: sign-in form stays available`, await page.locator('#email').isVisible());
      ok(`${name}: notice code is removed from the address bar`, new URL(page.url()).search === '');
      ok(`${name}: no success claim while unconfirmed`, (await page.getByText('The server confirmed').count()) === 0);
      // Try again, now Identity answers: the notice goes and the confirmation appears.
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByText('The server confirmed that your session has ended.').waitFor();
      ok(`${name}: Try again confirms only after Identity answers`, (await banner.count()) === 0 && calls.logout === 3);
    });
  }

  await scenario(browser, 'retry succeeds', { logout: [500, 'ok'] }, async ({ page, calls }) => {
    await openShell(page);
    await openSignOut(page);
    await signOutDialog(page).getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
    await page.locator('#email').waitFor({ timeout: 15_000 });
    ok('retry succeeds: no failure notice', (await page.getByText('could not confirm').count()) === 0);
    ok('retry succeeds: two logout requests (first failed, retry confirmed)', calls.logout === 2);
  });

  await scenario(browser, 'dirty form', {}, async ({ page, calls }) => {
    await openShell(page);
    await page.getByRole('button', { name: '+ Add Office' }).click();
    const form = page.getByRole('dialog', { name: 'Add Office' });
    await form.waitFor();
    // Known limitation: the modal backdrop covers the header, so the account menu (and with it Sign out)
    // cannot be clicked while a form is open. Confirm that, then open the menu and choose Sign out from
    // script to check the warning wiring.
    const blocked = await accountMenu(page).click({ trial: true, timeout: 1000 }).then(() => false, () => true);
    ok('dirty: Sign out is covered by the open form modal (known limitation)', blocked);
    const pressSignOut = async () => {
      await page.evaluate(() => document.querySelector('header button[aria-haspopup="menu"]').click());
      await signOutItem(page).waitFor();
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === 'Sign out').click());
    };

    await pressSignOut();
    await signOutDialog(page).waitFor();
    ok('dirty: an open but untouched form keeps the default message', await signOutDialog(page).getByText('You will need to sign in again to use CCMS.').isVisible());
    await page.keyboard.press('Escape');
    await signOutDialog(page).waitFor({ state: 'hidden' });
    ok('dirty: Escape closes only the top dialog (the form stays open)', await form.isVisible());

    await form.locator('#office_code').fill('E2E');
    await pressSignOut();
    await signOutDialog(page).waitFor();
    ok('dirty: changed form shows "You have unsaved changes. Sign out anyway?"', await signOutDialog(page).getByText('You have unsaved changes. Sign out anyway?').isVisible());
    await signOutDialog(page).getByRole('button', { name: 'Cancel' }).click();
    ok('dirty: cancelling keeps the form and its value', (await form.locator('#office_code').inputValue()) === 'E2E' && calls.logout === 0);

    await form.getByRole('button', { name: 'Cancel' }).click();
    await form.waitFor({ state: 'hidden' });
    await openSignOut(page);
    ok('dirty: after the form is cancelled the default message is back', await signOutDialog(page).getByText('You will need to sign in again to use CCMS.').isVisible());
  });

  await scenario(browser, 'invalid role', { seedRole: null, refreshRole: 'SUPER_ADMIN' }, async ({ page, calls }) => {
    await page.goto(BASE + '/login');
    await page.getByText('Your account role is not recognized. Contact a Super Admin.').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    ok('invalid role: sign-in page explains and keeps the form (no redirect)', (await page.locator('#email').isVisible()) && new URL(page.url()).pathname === '/login');

    await page.context().addCookies([{ name: 'ccms_signed_in', value: '1', url: BASE }]);
    await page.goto(BASE + '/offices');
    await page.getByText('Your account role is not recognized. Contact a Super Admin.').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    ok('invalid role: app shell explains instead of redirecting', new URL(page.url()).pathname === '/offices' && (await accountMenu(page).count()) === 0);
    ok('invalid role: the rejected token is never sent', calls.bearer.length === 0);
    ok('invalid role: nothing saved in sessionStorage', (await page.evaluate(() => sessionStorage.getItem('ccms_access'))) === null);
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await page.locator('#email').waitFor({ timeout: 15_000 });
    ok('invalid role: "Go to sign in" shows the sign-in form', true);
  });
}

// ---------------------------------------------------------------------------------------------------
// 2. Full-system smoke (real services, credentials and sample data)
// ---------------------------------------------------------------------------------------------------

async function fullSystemSmoke(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:3000/');
  await page.waitForSelector('text=SAMPLE Service Alpha');
  ok('public home lists services without login', true);
  await page.screenshot({ path: OUT + '/e2e-public.png' });

  await page.click('text=Staff login >> nth=-1');
  await page.waitForURL('**/login');
  await page.fill('input[type=email], input[name=email]', (process.env.ADMIN_EMAIL || 'admin@ccms.local'));
  await page.fill('input[type=password]', process.env.ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Sign out', { timeout: 15000 });
  ok('signed in, app shell visible at ' + page.url(), true);
  await page.screenshot({ path: OUT + '/e2e-home.png' });

  const cookies = await ctx.cookies();
  const refresh = cookies.find((c) => /refresh/i.test(c.name));
  ok('refresh cookie is httpOnly on the frontend origin (path ' + refresh?.path + ')', !!refresh && refresh.httpOnly);
  ok('signed-in marker cookie present', cookies.some((c) => c.name === 'ccms_signed_in'));

  await page.goto('http://localhost:3000/accounts');
  await page.waitForSelector('text=admin@ccms.local', { timeout: 15000 });
  ok('accounts page lists the admin (Identity via gateway)', true);
  await page.screenshot({ path: OUT + '/e2e-accounts.png' });

  await page.goto('http://localhost:3000/offices');
  await page.waitForSelector('text=SAMPLE OFFICE ONE', { timeout: 15000 });
  ok('offices page lists offices (Core via gateway)', true);

  // create a service with fees + who may avail via the API from the signed-in page, then check the screens
  const created = await page.evaluate(async () => {
    const token = JSON.parse(sessionStorage.getItem('ccms_access')).token;
    const h = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const offices = await (await fetch('/api/catalogue/offices', { headers: h })).json();
    const office = (offices.items ?? offices.offices ?? [])[0];
    const res = await fetch('/api/catalogue/services', { method: 'POST', headers: h, body: JSON.stringify({
      office_id: office.office_id, service_code: office.office_code + '-E2E-001', service_name: 'E2E Fees Service', classification: 'SIMPLE', transaction_type: 'G2C',
      fees: 'PHP 50.00 per copy', who_may_avail: 'Currently enrolled students',
      standard: { charter_reference: 'Charter p. 9', duration_value: 3, duration_unit: 'WORKING_DAYS', effective_from: new Date().toISOString().slice(0, 10) },
    }) });
    const body = await res.json(); if (res.status !== 201) console.log(JSON.stringify(body)); return { status: res.status, body };
  });
  ok('service with fees/who_may_avail created through the gateway (' + created.status + ')', created.status === 201);
  const id = created.body.service?.service_id;
  await page.goto('http://localhost:3000/services/' + id);
  await page.waitForSelector('text=PHP 50.00 per copy', { timeout: 15000 });
  await page.waitForSelector('text=Currently enrolled students');
  ok('staff service page shows Teph\'s fees and who may avail', true);
  await page.screenshot({ path: OUT + '/e2e-service.png' });

  await page.goto('http://localhost:3000/calendar');
  await page.waitForSelector('text=Calendar', { timeout: 15000 });
  await page.waitForTimeout(1500);
  ok('calendar page loads (Core calendar via gateway)', !(await page.locator('text=Something went wrong').count()));
  await page.screenshot({ path: OUT + '/e2e-calendar.png' });

  // token rule: no token = 401 from the gateway
  const noToken = await page.evaluate(async () => (await fetch('/api/catalogue/offices')).status);
  ok('gateway refuses /api/catalogue/offices with no token (401)', noToken === 401);
  const jobs = await page.evaluate(async () => (await fetch('/api/catalogue/jobs/outbox', { headers: { authorization: 'Bearer dev-cron-secret' } })).status);
  ok('cron job route is not reachable through the gateway (404)', jobs === 404);

  await page.click('text=Sign out');
  await page.click('[role=alertdialog] button:has-text("Sign out")'); // confirm (Phase 1 asks first)
  await page.waitForURL(/localhost:3000\/(login.*)?$/, { timeout: 15000 });
  ok('signed out -> ' + page.url(), true);
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('text=Staff login');
  await page.fill('#public-search', 'E2E Fees');
  await page.click('button:has-text("Search")');
  await page.waitForSelector('text=E2E Fees Service');
  await page.click('text=View requirements');
  await page.waitForSelector('text=PHP 50.00 per copy', { timeout: 15000 });
  ok('public detail shows fees and who may avail', true);
  await page.screenshot({ path: OUT + '/e2e-public-detail.png' });

  console.log(errors.length ? 'BROWSER ERRORS:\n' + errors.join('\n') : 'no browser errors');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await logoutChecks(browser);
    if (process.env.ADMIN_PASSWORD) await fullSystemSmoke(browser);
    else console.log('SKIP full-system smoke (set ADMIN_EMAIL and ADMIN_PASSWORD; needs every service, the Super Admin and sample data)');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('E2E FAILED', e.message); process.exit(1); });
