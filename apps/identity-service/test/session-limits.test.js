import { strict as assert } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as policyRoute } from '../src/app/api/session-policy/route.js';
import { POST as loginRoute, setLoginLimiter } from '../src/app/api/auth/login/route.js';
import { POST as refreshRoute } from '../src/app/api/auth/refresh/route.js';
import { DEFAULT_LIMITS, limitsFor, policyView } from '../src/lib/session-policy.js';
import { PASSWORD, refreshTokenFrom, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

// S8-33 / S8-34 (BE): per-role idle and absolute limits for password sign-in. Off unless SESSION_POLICY_ENABLED=true.
let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());
afterEach(() => {
  delete process.env.SESSION_POLICY_ENABLED;
  delete process.env.SESSION_POLICY_OVERRIDES;
  setLoginLimiter(null);
});

const login = (email) => loginRoute(req('POST', '/auth/login', { body: { email, password: PASSWORD } }));
const refresh = (token) => refreshRoute(req('POST', '/auth/refresh', { cookie: `ccms_refresh=${token}` }));
const codeOf = async (response) => (await response.json()).error?.code;
const MIN = 60_000;
const lastRow = async (accountId) => (await ds.query('SELECT * FROM refresh_tokens WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1', [accountId]))[0];
const ageToken = (accountId, minutes) =>
  ds.query("UPDATE refresh_tokens SET created_at = created_at - ($2 * interval '1 minute') WHERE account_id = $1 AND revoked_at IS NULL", [accountId, minutes]);

async function signedIn(role, email) {
  const account = await seedAccount(ds, { role, email });
  const res = await login(email);
  assert.equal(res.status, 200);
  return { account, token: refreshTokenFrom(res) };
}

describe('S8-33 session limits', () => {
  it('switch off (default): sign-in keeps the usual 7-day refresh token and renewing works as before', async () => {
    const { account, token } = await signedIn(ROLES.OFFICE_STAFF, 'off.staff@pup.edu.ph');
    const days = (new Date((await lastRow(account.accountId)).expires_at) - Date.now()) / (24 * 60 * MIN);
    assert.ok(days > 6.9 && days <= 7.01, `expected about 7 days, got ${days}`);
    await ageToken(account.accountId, 600); // would be idle under the policy, but the policy is off
    assert.equal((await refresh(token)).status, 200);
  });

  it('switch on: a new sign-in expires after the role\'s absolute limit', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const { account } = await signedIn(ROLES.OFFICE_STAFF, 'on.staff@pup.edu.ph');
    const minutes = (new Date((await lastRow(account.accountId)).expires_at) - Date.now()) / MIN;
    assert.ok(Math.abs(minutes - DEFAULT_LIMITS[ROLES.OFFICE_STAFF].absoluteMinutes) < 1, `got ${minutes} minutes`);
  });

  it('switch on: renewing while active works and never extends the absolute expiry', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const { account, token } = await signedIn(ROLES.OFFICE_HEAD, 'on.head@pup.edu.ph');
    const first = await lastRow(account.accountId);
    const res = await refresh(token);
    assert.equal(res.status, 200);
    const next = refreshTokenFrom(res);
    assert.ok(next && next !== token);
    assert.equal(new Date((await lastRow(account.accountId)).expires_at).getTime(), new Date(first.expires_at).getTime());
    assert.equal((await refresh(token)).status, 401, 'the old token cannot be used twice');
  });

  it('switch on: an idle session is refused, the token is revoked and the cookie cleared', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const { account, token } = await signedIn(ROLES.OFFICE_STAFF, 'idle.staff@pup.edu.ph');
    await ageToken(account.accountId, DEFAULT_LIMITS[ROLES.OFFICE_STAFF].idleMinutes + 1);
    const res = await refresh(token);
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), 'SESSION_IDLE_TIMEOUT');
    assert.match(res.headers.get('set-cookie') ?? '', /ccms_refresh=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    assert.equal((await refresh(token)).status, 401);
  });

  it('switch on: the limit depends on the role (a Super Admin idles out sooner than Office Staff)', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const admin = await signedIn(ROLES.SUPER_ADMIN, 'role.admin@pup.edu.ph');
    const staff = await signedIn(ROLES.OFFICE_STAFF, 'role.staff@pup.edu.ph');
    await ageToken(admin.account.accountId, 16);
    await ageToken(staff.account.accountId, 16);
    assert.equal(await codeOf(await refresh(admin.token)), 'SESSION_IDLE_TIMEOUT');
    assert.equal((await refresh(staff.token)).status, 200);
  });

  it('switch on: a session past its absolute limit cannot be renewed even if it is active', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const { account, token } = await signedIn(ROLES.OFFICE_HEAD, 'abs.head@pup.edu.ph');
    await ds.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE account_id = $1", [account.accountId]);
    const res = await refresh(token);
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), 'SESSION_TIME_LIMIT');
  });

  it('switch on: a deactivated account and an unknown token cannot renew', async () => {
    process.env.SESSION_POLICY_ENABLED = 'true';
    const { account, token } = await signedIn(ROLES.OFFICE_STAFF, 'deact.staff@pup.edu.ph');
    await ds.query('UPDATE accounts SET is_active = false WHERE account_id = $1', [account.accountId]);
    assert.equal((await refresh(token)).status, 401);
    assert.equal((await refresh('not-a-real-token')).status, 401);
  });

  it('switch on: a session that began before the policy is capped once to a full absolute window', async () => {
    const { account, token } = await signedIn(ROLES.OFFICE_STAFF, 'legacy.staff@pup.edu.ph'); // switch off: 7-day token
    process.env.SESSION_POLICY_ENABLED = 'true';
    assert.equal((await refresh(token)).status, 200);
    const minutes = (new Date((await lastRow(account.accountId)).expires_at) - Date.now()) / MIN;
    assert.ok(minutes <= DEFAULT_LIMITS[ROLES.OFFICE_STAFF].absoluteMinutes + 1, `got ${minutes}`);
  });

  it('accelerated limits for a local test, and out-of-range overrides are ignored (never unlimited)', async () => {
    process.env.SESSION_POLICY_OVERRIDES = JSON.stringify({ office_staff: { idleMinutes: 1, absoluteMinutes: 3 }, office_head: { idleMinutes: 99999, absoluteMinutes: 0 } });
    assert.deepEqual(limitsFor(ROLES.OFFICE_STAFF), { idleMinutes: 1, absoluteMinutes: 3 });
    assert.deepEqual(limitsFor(ROLES.OFFICE_HEAD), DEFAULT_LIMITS[ROLES.OFFICE_HEAD]);
    process.env.SESSION_POLICY_OVERRIDES = 'not json';
    assert.deepEqual(limitsFor(ROLES.EXECUTIVE), DEFAULT_LIMITS[ROLES.EXECUTIVE]);
    assert.deepEqual(limitsFor('unknown_role'), DEFAULT_LIMITS[ROLES.SUPER_ADMIN]);
  });
});

describe('S8-34 read-only session policy', () => {
  it('a Super Admin sees the limits for every role and whether they are enforced', async () => {
    const admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
    const res = await policyRoute(req('GET', '/session-policy', { token: await tokenFor(admin) }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enforced, false);
    assert.deepEqual(body.roles.map((r) => r.role).sort(), Object.keys(DEFAULT_LIMITS).sort());
    assert.deepEqual(body, policyView());
    process.env.SESSION_POLICY_ENABLED = 'true';
    assert.equal((await (await policyRoute(req('GET', '/session-policy', { token: await tokenFor(admin) }))).json()).enforced, true);
  });

  it('other roles and anonymous callers are refused', async () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const account = await seedAccount(ds, { role });
      assert.equal((await policyRoute(req('GET', '/session-policy', { token: await tokenFor(account) }))).status, 403);
    }
    assert.equal((await policyRoute(req('GET', '/session-policy'))).status, 401);
  });
});
