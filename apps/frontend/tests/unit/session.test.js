import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

// The browser session client (src/lib/auth/session.js) with a fake window, sessionStorage and fetch.
// Roles are the canonical lowercase values from ccms-shared/roles (what Identity puts in the token).
const claims = { sub: 'u1', employee_no: 'E-1', full_name: 'Test User', role: 'super_admin', office_id: null };
const jwt = (extra = {}) => `h.${Buffer.from(JSON.stringify({ ...claims, ...extra })).toString('base64url')}.s`;
const tokenResponse = (expiresIn = 900, extra = {}) => new Response(JSON.stringify({ access_token: jwt(extra), expires_in: expiresIn }), { status: 200 });

let store;
let calls;
let nextResponses;
let counter = 0;
let jar;

beforeEach(() => {
  store = new Map();
  calls = [];
  nextResponses = [];
  jar = new Map();
  globalThis.document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(line) {
      const [pair, ...attrs] = line.split('; ');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => a === 'max-age=0')) jar.delete(k);
      else jar.set(k, v);
    },
  };
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { pathname: '/services', assign: (url) => calls.push(`assign ${url}`) },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`fetch ${url}`);
    if (init.headers?.authorization) calls.push(`auth ${url}`);
    const next = nextResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? new Response('{}', { status: 500 });
  };
});

// A fresh copy of the module is what a new page load sees (module state is lost, sessionStorage stays).
const freshPage = () => import(`../../src/lib/auth/session.js?page=${++counter}`);

describe('session client', () => {
  it('keeps the access token across page loads without calling Identity', async () => {
    const first = await freshPage();
    nextResponses.push(tokenResponse());
    await first.signIn('a@b.c', 'pw');
    calls.length = 0;
    const second = await freshPage();
    const user = await second.refreshSession();
    assert.equal(user.role, 'super_admin');
    assert.deepEqual(calls, [], 'a still-valid token needs no call to Identity');
    assert.ok(await second.getAccessToken());
  });

  it('ignores an expired saved token and asks Identity', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() - 1000 }));
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await page.refreshSession(), null);
    assert.deepEqual(calls, ['fetch /api/identity/auth/refresh']);
    assert.equal(store.has('ccms_access'), false);
  });

  it('an expired or revoked refresh token (401) signs the user out', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await page.refreshSession(), null);
  });

  it('Identity down (502) shows a clear message instead of signing out', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 502 }));
    await assert.rejects(page.refreshSession(), (e) => e.code === 'IDENTITY_UNAVAILABLE' && /sign-in service is not available/.test(e.message));
    nextResponses.push(new Error('connect ECONNREFUSED'));
    await assert.rejects(page.refreshSession(), (e) => e.code === 'IDENTITY_UNAVAILABLE');
    assert.ok(!calls.some((c) => c.startsWith('assign')), 'no redirect to a sign-in page that is also down');
  });

  it('with Identity down, a token that is close to expiry but still valid keeps working', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() + 10_000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 503 }));
    assert.ok(await page.getAccessToken());
  });

  it('with Identity down and the token expired, the user is told, not redirected', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 502 }));
    await assert.rejects(page.getAccessToken(), (e) => e.code === 'IDENTITY_UNAVAILABLE');
  });

  it('signing out in another app on the same host makes this one drop its saved token', async () => {
    const first = await freshPage();
    nextResponses.push(tokenResponse());
    await first.signIn('a@b.c', 'pw');
    jar.delete('ccms_signed_in'); // what a sign-out in another app (another port, same host) does
    calls.length = 0;
    const second = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await second.refreshSession(), null, 'no saved token is trusted; Identity says the session is gone');
    assert.ok(calls.some((c) => c.includes('/auth/refresh')));
  });

  it('sign out clears the saved token', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    assert.ok(store.has('ccms_access'));
    nextResponses.push(new Response(null, { status: 204 }));
    await page.signOut();
    assert.equal(store.has('ccms_access'), false);
    assert.ok(calls.includes('assign /login'));
  });

  it('sign out goes to the sign-in page to finish the job when Identity could not be reached', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    nextResponses.push(new Response('not found', { status: 404 }));
    await page.signOut();
    assert.equal(store.has('ccms_access'), false);
    assert.ok(calls.includes('assign /login?signed_out=1&notice=revoke_failed'));
  });

  it('sign out with Identity unreachable (network error) still clears the token and does not reject', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    nextResponses.push(new Error('connect ECONNREFUSED'));
    const result = await page.signOut();
    assert.equal(result.revoked, false);
    assert.equal(store.has('ccms_access'), false);
    assert.equal(jar.has('ccms_signed_in'), false);
    assert.deepEqual(calls.filter((c) => c.includes('/auth/logout')), ['fetch /api/identity/auth/logout'], 'revoked once');
    assert.ok(calls.includes('assign /login?signed_out=1&notice=revoke_failed'));
  });
});

describe('session client: role claim', () => {
  for (const [label, extra] of [
    ['missing', { role: undefined }],
    ['not a string', { role: 7 }],
    ['wrong case', { role: 'SUPER_ADMIN' }],
    ['unknown', { role: 'citizen' }],
  ]) {
    it(`sign-in with a ${label} role is refused and nothing is stored`, async () => {
      const page = await freshPage();
      nextResponses.push(tokenResponse(900, extra));
      await assert.rejects(page.signIn('a@b.c', 'pw'), (e) => e.code === 'ROLE_NOT_RECOGNIZED' && e.message === 'Your account role is not recognized. Contact a Super Admin.');
      assert.equal(page.currentUser(), null);
      assert.equal(store.has('ccms_access'), false);
      assert.equal(jar.has('ccms_signed_in'), false);
    });
  }

  it('a refresh that returns an unrecognized role ends the session, explains why, and never sends that token', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900, { role: 'Super_Admin' }));
    assert.equal(await page.refreshSession(), null);
    assert.equal(page.sessionRejection(), 'ROLE_NOT_RECOGNIZED');
    assert.equal(store.has('ccms_access'), false);
    // apiFetch asks Identity again (refused again) and sends no bearer token anywhere.
    nextResponses.push(tokenResponse(900, { role: 'Super_Admin' }));
    await assert.rejects(page.apiFetch('/api/catalogue/offices'), (e) => e.code === 'SESSION_ENDED');
    assert.ok(!calls.some((c) => c.startsWith('auth ')), 'the rejected token was never sent');
    assert.ok(!calls.includes('fetch /api/catalogue/offices'));
  });

  it('a saved token with an unrecognized role is not reused after a page load', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt({ role: 'admin' }), expiresAt: Date.now() + 600_000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    assert.equal(page.currentUser(), null);
    assert.equal(page.sessionRejection(), 'ROLE_NOT_RECOGNIZED');
    assert.equal(store.has('ccms_access'), false);
  });

  it('an expired saved token with a good role is not reported as a role problem', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() - 1000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    assert.equal(page.currentUser(), null);
    assert.equal(page.sessionRejection(), null);
  });

  it('a good sign-in after a rejection clears the rejection', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900, { role: 'nope' }));
    await assert.rejects(page.signIn('a@b.c', 'pw'));
    nextResponses.push(tokenResponse());
    const user = await page.signIn('a@b.c', 'pw');
    assert.equal(user.role, 'super_admin');
    assert.equal(page.sessionRejection(), null);
  });
});

describe('session client: sign-in failures', () => {
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });

  it('wrong credentials show the generic message', async () => {
    const page = await freshPage();
    nextResponses.push(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' } }));
    await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.status === 401 && e.message === 'Incorrect email or password');
  });

  it('429 shows the wait as minutes and seconds and keeps Retry-After', async () => {
    const page = await freshPage();
    const message = 'Too many sign-in attempts. Try again in 884 seconds.';
    nextResponses.push(json(429, { error: { code: 'RATE_LIMITED', message } }, { 'retry-after': '884' }));
    await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.status === 429 && e.message === 'Too many sign-in attempts. Try again in 14 minutes 44 seconds.' && e.retryAfterSeconds === 884);
    assert.equal(calls.filter((c) => c.includes('/auth/login')).length, 1, 'no automatic retry');
    assert.equal(store.has('ccms_access'), false);
  });

  it('429 without a usable body falls back to Retry-After, then to a plain message', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('<html>nope</html>', { status: 429, headers: { 'retry-after': '30' } }));
    await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.message === 'Too many sign-in attempts. Try again in 30 seconds.');
    nextResponses.push(new Response('', { status: 429 }));
    await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.message === 'Too many sign-in attempts. Please wait a moment and try again.');
  });

  it('503 shows a safe temporary message and never the server text', async () => {
    const page = await freshPage();
    nextResponses.push(json(503, { error: { code: 'SIGN_IN_UNAVAILABLE', message: 'db pool exhausted at pg.js:42', details: { stack: 'Error: boom' } } }));
    await assert.rejects(page.signIn('a@b.c', 'pw'), (e) => e.status === 503 && /temporarily unavailable/.test(e.message) && !/pg\.js|stack|boom/.test(e.message));
    nextResponses.push(new Response('Error: boom\n    at handler (route.js:1:1)', { status: 500 }));
    await assert.rejects(page.signIn('a@b.c', 'pw'), (e) => /temporarily unavailable/.test(e.message) && !/boom|route\.js/.test(e.message));
  });
});

describe('session client: one refresh per tab', () => {
  const refreshCalls = () => calls.filter((c) => c === 'fetch /api/identity/auth/refresh').length;

  // Routes by URL: refresh answers after a tick, API calls answer from `api`.
  function route({ refresh, api }) {
    globalThis.fetch = async (url, init = {}) => {
      calls.push(`fetch ${url}`);
      if (init.headers?.authorization) calls.push(`auth ${url} ${init.headers.authorization.slice(-6)}`);
      await new Promise((r) => setTimeout(r, 5));
      return url.endsWith('/auth/refresh') ? refresh() : api(url, init);
    };
  }

  async function signedInButStale() {
    const page = await freshPage();
    nextResponses.push(tokenResponse(10)); // inside the refresh margin: the next call must refresh
    await page.signIn('a@b.c', 'pw');
    calls.length = 0;
    return page;
  }

  it('concurrent API calls share one refresh and then all run with the new token', async () => {
    const page = await signedInButStale();
    route({ refresh: () => tokenResponse(900, { jti: 'fresh' }), api: () => new Response('{"ok":true}', { status: 200 }) });
    const results = await Promise.all([page.apiFetch('/api/a'), page.apiFetch('/api/b'), page.apiFetch('/api/c')]);
    assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
    assert.equal(refreshCalls(), 1);
    const sent = calls.filter((c) => c.startsWith('auth '));
    assert.equal(sent.length, 3);
    assert.equal(new Set(sent.map((c) => c.split(' ')[2])).size, 1, 'all three used the same refreshed token');
  });

  it('401s that arrive at different times cause one refresh, and a late 401 does not discard the new token', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900));
    await page.signIn('a@b.c', 'pw'); // a fresh token that the API will refuse
    calls.length = 0;
    const refused = jwt();
    const delays = { '/api/a': 0, '/api/b': 40, '/api/c': 80 };
    globalThis.fetch = async (url, init = {}) => {
      calls.push(`fetch ${url}`);
      await new Promise((r) => setTimeout(r, url.endsWith('/auth/refresh') ? 5 : (delays[url] ?? 0)));
      if (url.endsWith('/auth/refresh')) return tokenResponse(900, { jti: 'second' });
      return init.headers.authorization === `Bearer ${refused}` ? new Response('{}', { status: 401 }) : new Response('{"ok":true}', { status: 200 });
    };
    const all = await Promise.all([page.apiFetch('/api/a'), page.apiFetch('/api/b'), page.apiFetch('/api/c')]);
    assert.deepEqual(all, [{ ok: true }, { ok: true }, { ok: true }]);
    assert.equal(refreshCalls(), 1, 'the second and third 401 reuse the token the first refresh produced');
  });

  it('a failed refresh signs out once: no loop, one redirect per request, nothing sent without a token', async () => {
    const page = await signedInButStale();
    route({ refresh: () => new Response('{}', { status: 401 }), api: () => new Response('{}', { status: 200 }) });
    const results = await Promise.allSettled([page.apiFetch('/api/a'), page.apiFetch('/api/b')]);
    assert.ok(results.every((r) => r.status === 'rejected' && r.reason.code === 'SESSION_ENDED'));
    assert.equal(refreshCalls(), 1);
    assert.ok(!calls.some((c) => c.startsWith('auth ')), 'no API call was made');
    assert.ok(calls.includes('assign /login'));
  });

  it('an API that keeps answering 401 is retried once, with one refresh, then sent to sign-in', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900));
    await page.signIn('a@b.c', 'pw');
    calls.length = 0;
    route({ refresh: () => tokenResponse(900), api: () => new Response('{"error":{"code":"UNAUTHORIZED","message":"no"}}', { status: 401 }) });
    await assert.rejects(page.apiFetch('/api/a'), (e) => e.status === 401);
    assert.equal(calls.filter((c) => c === 'fetch /api/a').length, 2, 'original request plus one retry');
    assert.equal(refreshCalls(), 1);
    assert.ok(calls.includes('assign /login'));
  });
});

describe('formatWait', () => {
  it('shows seconds below a minute, minutes from a minute, and both when there is a remainder', async () => {
    const { formatWait } = await freshPage();
    assert.equal(formatWait(1), '1 second');
    assert.equal(formatWait(59), '59 seconds');
    assert.equal(formatWait(60), '1 minute');
    assert.equal(formatWait(61), '1 minute 1 second');
    assert.equal(formatWait(120), '2 minutes');
    assert.equal(formatWait(884), '14 minutes 44 seconds');
    assert.equal(formatWait(900), '15 minutes');
  });

  it('429 messages use it, whether the wait comes from the header or from the message text', async () => {
    const page = await freshPage();
    for (const [seconds, text] of [[1, '1 second'], [59, '59 seconds'], [60, '1 minute'], [120, '2 minutes'], [884, '14 minutes 44 seconds']]) {
      nextResponses.push(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: `Too many sign-in attempts. Try again in ${seconds} seconds.` } }), { status: 429 }));
      await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.message === `Too many sign-in attempts. Try again in ${text}.` && e.retryAfterSeconds === seconds);
      nextResponses.push(new Response('{}', { status: 429, headers: { 'retry-after': String(seconds) } }));
      await assert.rejects(page.signIn('a@b.c', 'bad'), (e) => e.message === `Too many sign-in attempts. Try again in ${text}.`);
    }
  });
});
