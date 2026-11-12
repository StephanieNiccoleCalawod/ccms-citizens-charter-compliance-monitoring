import { strict as assert } from 'node:assert';
import { after, afterEach, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as internalRoute } from '../src/app/api/internal/permission-switches/route.js';
import { GET as meRoute } from '../src/app/api/me/route.js';
import { PUT as passwordRoute } from '../src/app/api/me/password/route.js';
import { GET as switchesGet, PUT as switchesPut } from '../src/app/api/permission-switches/route.js';
import { POST as loginRoute } from '../src/app/api/auth/login/route.js';
import { PASSWORD, outboxEvents, refreshTokenFrom, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());
afterEach(() => ds.query(`UPDATE permission_switches SET enabled = false`));

const as = async (role) => {
  const account = await seedAccount(ds, { role });
  return { account, token: await tokenFor(account) };
};
const KEYS = ['STAFF_BACKDATE', 'STAFF_HOLD_RESUME', 'STAFF_VIEW_COMPLAINTS', 'STAFF_VIEW_REPORTS'];

describe('CC056 permission switches', () => {
  it('starts with exactly the four switches, all off', async () => {
    const { token } = await as(ROLES.SUPER_ADMIN);
    const body = await (await switchesGet(req('GET', '/permission-switches', { token }))).json();
    assert.deepEqual(body.switches.map((s) => s.key).sort(), KEYS);
    assert.ok(body.switches.every((s) => s.enabled === false));
    assert.ok(body.matrix.rows.length > 5);
    assert.ok(body.matrix.roles.some((r) => r.role === ROLES.OFFICE_STAFF));
  });

  it('only the Super Admin can read or change them', async () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE, ROLES.CHARTER_FOCAL]) {
      if (!ROLES[Object.keys(ROLES).find((k) => ROLES[k] === role)]) continue;
      const { token } = await as(role);
      assert.equal((await switchesGet(req('GET', '/permission-switches', { token }))).status, 403);
      assert.equal((await switchesPut(req('PUT', '/permission-switches', { token, body: { switches: { STAFF_BACKDATE: true } } }))).status, 403);
    }
    assert.equal((await switchesGet(req('GET', '/permission-switches'))).status, 401);
  });

  it('turning one on persists, records who, and writes an audit event with before and after', async () => {
    const { account, token } = await as(ROLES.SUPER_ADMIN);
    const res = await switchesPut(req('PUT', '/permission-switches', { token, body: { switches: { STAFF_HOLD_RESUME: true } } }));
    assert.equal(res.status, 200);
    const body = await res.json();
    const row = body.switches.find((s) => s.key === 'STAFF_HOLD_RESUME');
    assert.equal(row.enabled, true);
    assert.equal(row.updated_by, account.accountId);
    assert.equal(body.switches.find((s) => s.key === 'STAFF_BACKDATE').enabled, false);
    const events = (await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).filter((e) => e.entity_id === 'STAFF_HOLD_RESUME');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].before_value, { switch: 'STAFF_HOLD_RESUME', enabled: false });
    assert.deepEqual(events[0].after_value, { switch: 'STAFF_HOLD_RESUME', enabled: true });
    assert.equal(events[0].actor_user_id, account.accountId);
  });

  it('setting a switch to the value it already has changes nothing and writes no audit event', async () => {
    const { token } = await as(ROLES.SUPER_ADMIN);
    const before = (await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length;
    await switchesPut(req('PUT', '/permission-switches', { token, body: { switches: { STAFF_VIEW_REPORTS: false } } }));
    assert.equal((await outboxEvents(ds, 'PERMISSION_SWITCH_CHANGED')).length, before);
  });

  it('refuses unknown keys, non-booleans and empty bodies, and changes nothing', async () => {
    const { token } = await as(ROLES.SUPER_ADMIN);
    for (const body of [{}, { switches: {} }, { switches: { STAFF_DELETE_EVERYTHING: true } }, { switches: { STAFF_BACKDATE: 'yes' } }, { switches: { STAFF_BACKDATE: true, NOPE: true } }, { switches: [] }]) {
      const res = await switchesPut(req('PUT', '/permission-switches', { token, body }));
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const rows = await ds.query('SELECT enabled FROM permission_switches');
    assert.ok(rows.every((r) => r.enabled === false));
  });

  it('the database refuses a fifth switch key', async () => {
    await assert.rejects(ds.query(`INSERT INTO permission_switches (switch_key, enabled) VALUES ('STAFF_ANYTHING', true)`));
  });

  it('the internal read needs the service key and returns the four values', async () => {
    assert.equal((await internalRoute(req('GET', '/internal/permission-switches'))).status, 401);
    const { token } = await as(ROLES.SUPER_ADMIN);
    assert.notEqual((await internalRoute(req('GET', '/internal/permission-switches', { token }))).status, 200, 'a user token is not a service key');
    await switchesPut(req('PUT', '/permission-switches', { token, body: { switches: { STAFF_BACKDATE: true } } }));
    const res = await internalRoute(req('GET', '/internal/permission-switches', { headers: { 'x-service-key': process.env.SERVICE_KEY } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { switches: { STAFF_BACKDATE: true, STAFF_HOLD_RESUME: false, STAFF_VIEW_COMPLAINTS: false, STAFF_VIEW_REPORTS: false } });
  });
});

describe('CC056 My account', () => {
  it('returns the caller’s own details, with no password data', async () => {
    const { account, token } = await as(ROLES.OFFICE_STAFF);
    const res = await meRoute(req('GET', '/me', { token }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.account.account_id, account.accountId);
    assert.equal(body.account.email, account.email);
    assert.equal(body.account.role, ROLES.OFFICE_STAFF);
    assert.ok(body.account.role_label);
    assert.ok(!JSON.stringify(body).toLowerCase().includes('hash'));
    assert.equal(body.account.last_login_at, null, 'never signed in yet');
    assert.equal((await meRoute(req('GET', '/me'))).status, 401);
  });

  it('shows the last sign-in after a login', async () => {
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    const login = await loginRoute(req('POST', '/auth/login', { body: { email: staff.email, password: PASSWORD } }));
    assert.equal(login.status, 200);
    const { access_token } = await login.json();
    const body = await (await meRoute(req('GET', '/me', { token: access_token }))).json();
    assert.ok(Date.now() - new Date(body.account.last_login_at).getTime() < 60_000);
  });

  it('"What I can do" follows the role, and a switch changes only the Office Staff entry', async () => {
    const staff = await as(ROLES.OFFICE_STAFF);
    const admin = await as(ROLES.SUPER_ADMIN);
    const find = (b, key) => b.what_i_can_do.find((r) => r.key === key);
    const off = await (await meRoute(req('GET', '/me', { token: staff.token }))).json();
    const hold = off.what_i_can_do.find((r) => r.switch_key === 'STAFF_HOLD_RESUME');
    assert.ok(hold, 'a hold/resume row exists');
    assert.equal(hold.access, 'no');
    assert.equal(hold.switch_on, false);
    await switchesPut(req('PUT', '/permission-switches', { token: admin.token, body: { switches: { STAFF_HOLD_RESUME: true } } }));
    const on = await (await meRoute(req('GET', '/me', { token: staff.token }))).json();
    assert.equal(find(on, hold.key).access, 'yes');
    const headBody = await (await meRoute(req('GET', '/me', { token: (await as(ROLES.OFFICE_HEAD)).token }))).json();
    assert.equal(find(headBody, hold.key).switch_key, null, 'the head’s row does not depend on a switch');
  });

  it('a deactivated account’s token no longer works for /me', async () => {
    const { account, token } = await as(ROLES.OFFICE_STAFF);
    await ds.query('UPDATE accounts SET is_active = false WHERE account_id = $1', [account.accountId]);
    assert.equal((await meRoute(req('GET', '/me', { token }))).status, 401);
  });
});

describe('CC056 change own password', () => {
  const change = (token, body, cookie) => passwordRoute(req('PUT', '/me/password', { token, body, cookie }));
  const NEW = 'BrandNew#Pass99';

  it('rejects a wrong current password and a weak or unchanged new one, without changing anything', async () => {
    const { account, token } = await as(ROLES.OFFICE_STAFF);
    const wrong = await change(token, { current_password: 'nope', new_password: NEW });
    assert.equal(wrong.status, 400);
    assert.ok((await wrong.json()).error.details.current_password);
    assert.equal((await change(token, { current_password: PASSWORD, new_password: 'short' })).status, 400);
    assert.equal((await change(token, { current_password: PASSWORD, new_password: PASSWORD })).status, 400);
    assert.equal((await change(token, {})).status, 400);
    const ok = await loginRoute(req('POST', '/auth/login', { body: { email: account.email, password: PASSWORD } }));
    assert.equal(ok.status, 200, 'the old password still works');
  });

  it('changes the password, ends other sessions, keeps this one, and audits without any password value', async () => {
    const { account, token } = await as(ROLES.OFFICE_STAFF);
    const here = refreshTokenFrom(await loginRoute(req('POST', '/auth/login', { body: { email: account.email, password: PASSWORD } })));
    const other = refreshTokenFrom(await loginRoute(req('POST', '/auth/login', { body: { email: account.email, password: PASSWORD } })));
    assert.ok(here && other);
    const res = await change(token, { current_password: PASSWORD, new_password: NEW }, `ccms_refresh=${here}`);
    assert.equal(res.status, 200);
    const old = await loginRoute(req('POST', '/auth/login', { body: { email: account.email, password: PASSWORD } }));
    assert.equal(old.status, 401);
    const fresh = await loginRoute(req('POST', '/auth/login', { body: { email: account.email, password: NEW } }));
    assert.equal(fresh.status, 200);
    const live = await ds.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE account_id = $1 AND revoked_at IS NULL`, [account.accountId]);
    assert.equal(live[0].n, 2, 'this session and the fresh login are alive; the other one was ended');
    const events = (await outboxEvents(ds, 'PASSWORD_CHANGED')).filter((e) => e.entity_id === account.accountId);
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events[0]).includes(NEW) && !JSON.stringify(events[0]).includes(PASSWORD));
  });

  it('is open to every role, including a read-only Executive, and needs a sign-in', async () => {
    const exec = await as(ROLES.EXECUTIVE);
    assert.equal((await change(exec.token, { current_password: PASSWORD, new_password: NEW })).status, 200);
    assert.equal((await change(undefined, { current_password: PASSWORD, new_password: NEW })).status, 401);
  });
});
