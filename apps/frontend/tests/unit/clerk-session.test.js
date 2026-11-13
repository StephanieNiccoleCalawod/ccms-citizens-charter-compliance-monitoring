import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { registerClerk } from '../../src/lib/auth/clerk-bridge.js';
import { authProvider, clerkEnabled, signInPath } from '../../src/lib/auth/provider.js';
import { clerkAccessNav } from '../../src/lib/auth/permissions.js';
import { accessPendingCopy, accountLabel, bindableAccounts, clerkSessionState, pendingTaskLabel } from '../../src/lib/ui/clerk-access.js';

// Clerk sign-in (Landas 1) in the browser session client, with a fake window, sessionStorage, fetch and Clerk instance.
const claims = { sub: 'acc-1', employee_no: 'E-1', full_name: 'Test User', role: 'office_head', office_id: 'off-1' };
const jwt = (extra = {}) => `h.${Buffer.from(JSON.stringify({ ...claims, ...extra })).toString('base64url')}.s`;
const ok = () => new Response(JSON.stringify({ access_token: jwt(), expires_in: 900, token_type: 'Bearer' }), { status: 200 });
const fail = (status, code) => new Response(JSON.stringify({ error: { code, message: `msg ${code}` } }), { status });
const KEY = 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk';

let store;
let calls;
let nextResponses;
let counter = 0;
let clerk;

function fakeClerk({ signedIn = true, token = 'clerk.session.token' } = {}) {
  return {
    signOutCalls: 0,
    session: signedIn ? { getToken: async () => token } : null,
    async signOut() {
      this.signOutCalls += 1;
      this.session = null;
    },
  };
}

beforeEach(() => {
  store = new Map();
  calls = [];
  nextResponses = [];
  const jar = new Map();
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
    location: { pathname: '/office', search: '', assign: (url) => calls.push(`assign ${url}`) },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`fetch ${url}${init.headers?.authorization ? ` [${init.headers.authorization}]` : ''}`);
    const next = nextResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? new Response('{}', { status: 500 });
  };
  process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'clerk';
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = KEY;
  clerk = fakeClerk();
  registerClerk(clerk);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_AUTH_PROVIDER;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
});

const freshPage = () => import(`../../src/lib/auth/session.js?clerk=${++counter}`);

describe('auth provider switch', () => {
  it('is legacy unless the switch says dual or clerk', () => {
    delete process.env.NEXT_PUBLIC_AUTH_PROVIDER;
    assert.equal(authProvider(), 'legacy');
    for (const value of ['', 'CLERK ', 'dual', 'nonsense']) {
      process.env.NEXT_PUBLIC_AUTH_PROVIDER = value;
      assert.equal(authProvider(), { 'CLERK ': 'clerk', dual: 'dual' }[value] ?? 'legacy');
    }
  });

  it('keeps Clerk off without a real publishable key, so nothing changes for anyone', () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'sk_test_secret_should_never_be_here';
    assert.equal(clerkEnabled(), false);
    assert.equal(signInPath(), '/login');
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    assert.equal(clerkEnabled(), false);
  });

  it('sends a signed-out person to the Clerk page only when Clerk is the only sign-in', () => {
    assert.equal(signInPath(), '/login/clerk');
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'dual';
    assert.equal(signInPath(), '/login');
  });

  it('shows the Super Admin menu item only while Clerk is on', () => {
    assert.equal(clerkAccessNav('super_admin').href, '/settings/clerk-access');
    assert.equal(clerkAccessNav('office_head'), null);
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'legacy';
    assert.equal(clerkAccessNav('super_admin'), null);
  });
});

describe('session client with Clerk', () => {
  it('trades the Clerk token for a CCMS token at Identity and never calls the password refresh', async () => {
    const session = await freshPage();
    nextResponses.push(ok());
    const user = await session.completeClerkSignIn();
    assert.equal(user.role, 'office_head');
    assert.deepEqual(calls, ['fetch /api/identity/auth/clerk/exchange [Bearer clerk.session.token]']);
    assert.ok(session.mightBeSignedIn());
  });

  it('a valid Clerk sign-in without CCMS access goes to the "No access yet" page with the reason, not back to sign-in', async () => {
    const session = await freshPage();
    nextResponses.push(fail(403, 'CCMS_ACCESS_PENDING'));
    assert.equal(await session.refreshSession(true), null);
    assert.equal(session.sessionRejection(), 'CCMS_ACCESS_PENDING');
    session.redirectToLogin();
    assert.equal(calls.at(-1), 'assign /access-pending?reason=CCMS_ACCESS_PENDING');
  });

  it('an unknown 403 code is not treated as "No access yet"', async () => {
    const session = await freshPage();
    nextResponses.push(fail(403, 'SOMETHING_ELSE'));
    assert.equal(await session.refreshSession(true), null);
    assert.equal(session.sessionRejection(), null);
  });

  it('signed out of Clerk means signed out of CCMS (no request to Identity)', async () => {
    registerClerk(fakeClerk({ signedIn: false }));
    const session = await freshPage();
    assert.equal(await session.refreshSession(true), null);
    assert.deepEqual(calls, []);
    session.redirectToLogin();
    assert.equal(calls.at(-1), 'assign /login/clerk');
  });

  it('Identity unreachable is "try again", not a sign-out', async () => {
    const session = await freshPage();
    nextResponses.push(fail(503, 'SERVICE_UNAVAILABLE'));
    await assert.rejects(session.refreshSession(true), { code: 'IDENTITY_UNAVAILABLE' });
    nextResponses.push(new TypeError('network'));
    await assert.rejects(session.refreshSession(true), { code: 'IDENTITY_UNAVAILABLE' });
  });

  it('signing out ends the Clerk session, clears the CCMS token and returns to the Clerk sign-in page', async () => {
    const session = await freshPage();
    nextResponses.push(ok());
    await session.completeClerkSignIn();
    await session.signOut();
    assert.equal(clerk.signOutCalls, 1);
    assert.equal(session.currentUser(), null);
    assert.equal(calls.at(-1), 'assign /login/clerk');
    assert.ok(!calls.some((c) => c.includes('/auth/logout')));
  });
});

describe('session client in dual mode', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'dual';
  });

  it('a new tab tries the password session first, then Clerk, and remembers which one worked', async () => {
    const session = await freshPage();
    nextResponses.push(fail(401, 'INVALID_REFRESH_TOKEN'), ok());
    const user = await session.refreshSession(true);
    assert.equal(user.id, 'acc-1');
    assert.deepEqual(calls, ['fetch /api/identity/auth/refresh', 'fetch /api/identity/auth/clerk/exchange [Bearer clerk.session.token]']);
    calls.length = 0;
    nextResponses.push(ok());
    await session.refreshSession(true);
    assert.deepEqual(calls, ['fetch /api/identity/auth/clerk/exchange [Bearer clerk.session.token]']);
  });

  it('a password sign-in keeps using the password session', async () => {
    const session = await freshPage();
    nextResponses.push(ok());
    await session.signIn('a@example.test', 'pw');
    calls.length = 0;
    nextResponses.push(ok());
    await session.refreshSession(true);
    assert.deepEqual(calls, ['fetch /api/identity/auth/refresh']);
  });

  it('signing out without a remembered sign-in ends both the password session and any Clerk session', async () => {
    const session = await freshPage();
    nextResponses.push(new Response(null, { status: 204 }));
    await session.signOut();
    assert.ok(calls.includes('fetch /api/identity/auth/logout'));
    assert.equal(clerk.signOutCalls, 1);
  });

  it('"No access yet" from Clerk stops there instead of trying another sign-in', async () => {
    store.set('ccms_auth_method', 'clerk');
    const session = await freshPage();
    nextResponses.push(fail(403, 'ACCOUNT_INACTIVE'));
    assert.equal(await session.refreshSession(true), null);
    assert.equal(calls.length, 1);
    assert.equal(session.sessionRejection(), 'ACCOUNT_INACTIVE');
  });
});

describe('Clerk access screens', () => {
  it('never treats a pending Clerk session as signed out (that would reload the sign-in page forever)', () => {
    assert.equal(clerkSessionState(null), 'signed-out');
    assert.equal(clerkSessionState({ status: 'active' }), 'active');
    assert.equal(clerkSessionState({ status: 'pending', currentTask: { key: 'reset-password' } }), 'pending');
    assert.equal(clerkSessionState({ status: 'something-new' }), 'pending');
    assert.equal(pendingTaskLabel({ currentTask: { key: 'reset-password' } }), 'set a new password');
    assert.equal(pendingTaskLabel({ currentTask: { key: 'unknown-task' } }), 'finish one more step');
  });

  it('shows only known reasons, never text from the address bar', () => {
    assert.equal(accessPendingCopy('ACCOUNT_INACTIVE').title, 'Your CCMS access is turned off');
    assert.equal(accessPendingCopy('<script>').title, 'No access yet');
    assert.equal(accessPendingCopy(null).canRetry, true);
    assert.equal(accessPendingCopy('IMPERSONATION_NOT_ALLOWED').canRetry, false);
  });

  it('offers only active, unlinked accounts, with the exact-email suggestion first', () => {
    const accounts = [
      { account_id: 'a', full_name: 'Zed', employee_no: 'E-3', is_active: true },
      { account_id: 'b', full_name: 'Amy', employee_no: 'E-1', is_active: true },
      { account_id: 'c', full_name: 'Bea', employee_no: 'E-2', is_active: false },
      { account_id: 'd', full_name: 'Cid', employee_no: 'E-4', is_active: true },
    ];
    assert.deepEqual(bindableAccounts(accounts, ['d'], 'a').map((x) => x.account_id), ['a', 'b']);
    assert.deepEqual(bindableAccounts(accounts, [], null).map((x) => x.account_id), ['b', 'd', 'a']);
    assert.equal(accountLabel(accounts[1]), 'Amy (E-1)');
  });
});
