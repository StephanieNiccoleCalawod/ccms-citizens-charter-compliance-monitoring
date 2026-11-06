import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as listRoute, POST as createRoute } from '../src/app/api/accounts/route.js';
import { GET as getRoute, PUT as putRoute } from '../src/app/api/accounts/[id]/route.js';
import { PATCH as deactivateRoute } from '../src/app/api/accounts/[id]/deactivate/route.js';
import { PATCH as reactivateRoute } from '../src/app/api/accounts/[id]/reactivate/route.js';
import { POST as resetRoute } from '../src/app/api/accounts/[id]/reset-password/route.js';
import { POST as confirmResetRoute } from '../src/app/api/auth/password-reset/confirm/route.js';
import { POST as loginRoute } from '../src/app/api/auth/login/route.js';
import { POST as refreshRoute } from '../src/app/api/auth/refresh/route.js';
import {
  OFFICE_A,
  OFFICE_B,
  OFFICE_INACTIVE,
  PASSWORD,
  catalogue,
  ctx,
  mail,
  outboxEvents,
  refreshTokenFrom,
  req,
  seedAccount,
  setupTestEnv,
  tokenFor,
} from './helpers.js';

let env;
let ds;
let admin;
const tokens = {};

before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  admin = await seedAccount(ds, { role: ROLES.SUPER_ADMIN, email: 'root@pup.edu.ph', fullName: 'Root Admin' });
  tokens.admin = await tokenFor(admin);
  tokens.head = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_HEAD }));
  tokens.staff = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_STAFF }));
  tokens.exec = await tokenFor(await seedAccount(ds, { role: ROLES.EXECUTIVE }));
});
after(() => env?.cleanup());

const valid = (overrides = {}) => ({
  employee_no: `E-${Math.random().toString(36).slice(2, 8)}`,
  full_name: 'Ana Cruz',
  email: `ana.${Math.random().toString(36).slice(2, 8)}@pup.edu.ph`,
  role: ROLES.OFFICE_STAFF,
  office_id: OFFICE_A,
  password: PASSWORD,
  ...overrides,
});

async function create(body, token = tokens.admin) {
  const response = await createRoute(req('POST', '/accounts', { token, body }));
  return { response, body: await response.json() };
}
async function update(id, body, token = tokens.admin) {
  const response = await putRoute(req('PUT', `/accounts/${id}`, { token, body }), ctx(id));
  return { response, body: await response.json() };
}
const patch = (route, id, action, token = tokens.admin) => route(req('PATCH', `/accounts/${id}/${action}`, { token }), ctx(id));
const login = (email, password) => loginRoute(req('POST', '/auth/login', { body: { email, password } }));

describe('CC001 create account', () => {
  it('creates the accounts table and unique indexes automatically', async () => {
    const [t] = await ds.query(`SELECT to_regclass('public.accounts') AS t`);
    assert.equal(t.t, 'accounts');
    const idx = await ds.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'accounts'`);
    assert.ok(idx.some((i) => i.indexname === 'accounts_email_lower_uq'));
  });

  it('AC1: creates an Office Staff account; saved as active, listed, password stored as a salted hash', async () => {
    const input = valid({ email: 'Ana.Staff@pup.edu.ph' });
    const { response, body } = await create(input);
    assert.equal(response.status, 201);
    assert.equal(body.account.is_active, true);
    assert.equal(body.account.email, 'ana.staff@pup.edu.ph');
    assert.equal(body.account.office_id, OFFICE_A);
    assert.ok(!JSON.stringify(body).includes('password'), 'response must not include any password data');

    const [row] = await ds.query('SELECT password_hash FROM accounts WHERE account_id = $1', [body.account.account_id]);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes(PASSWORD));

    const list = await (await listRoute(req('GET', '/accounts', { token: tokens.admin }))).json();
    assert.ok(list.items.some((a) => a.account_id === body.account.account_id));
  });

  it('two accounts with the same password get different hashes (salted)', async () => {
    const a = await create(valid());
    const b = await create(valid());
    const rows = await ds.query('SELECT password_hash FROM accounts WHERE account_id IN ($1, $2)', [a.body.account.account_id, b.body.account.account_id]);
    assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  });

  it('AC2: a duplicate email (any letter case) is rejected with 409 "Email already in use"', async () => {
    await create(valid({ email: 'dupe@pup.edu.ph' }));
    for (const email of ['dupe@pup.edu.ph', 'DUPE@pup.edu.ph']) {
      const { response, body } = await create(valid({ email }));
      assert.equal(response.status, 409);
      assert.equal(body.error.message, 'Email already in use');
    }
  });

  it('rejects a duplicate employee number with 409', async () => {
    await create(valid({ employee_no: 'SAME-1' }));
    const { response, body } = await create(valid({ employee_no: 'SAME-1' }));
    assert.equal(response.status, 409);
    assert.equal(body.error.message, 'Employee number already in use');
  });

  it('AC3: Office Head or Office Staff without an office is rejected', async () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      const { response, body } = await create(valid({ role, office_id: undefined }));
      assert.equal(response.status, 400);
      assert.equal(body.error.message, 'Office is required for Office Head and Office Staff');
    }
  });

  it('AC4: Executive or Super Admin with an office is rejected', async () => {
    for (const role of [ROLES.EXECUTIVE, ROLES.SUPER_ADMIN]) {
      const { response, body } = await create(valid({ role, office_id: OFFICE_A }));
      assert.equal(response.status, 400);
      assert.equal(body.error.message, 'Executive and Super Admin accounts cannot have an office');
    }
  });

  it('AC5: an inactive or unknown office is rejected', async () => {
    for (const office_id of [OFFICE_INACTIVE, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'not-a-uuid']) {
      const { response, body } = await create(valid({ office_id }));
      assert.equal(response.status, 400);
      assert.equal(body.error.message, 'Office not found or inactive');
    }
  });

  it('AC6: when Catalogue is unreachable, office-bound accounts get 503 but Super Admin and Executive still save', async () => {
    catalogue.down = true;
    try {
      for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
        const { response, body } = await create(valid({ role }));
        assert.equal(response.status, 503);
        assert.equal(body.error.message, 'Cannot verify office right now, try again');
      }
      const executive = await create(valid({ role: ROLES.EXECUTIVE, office_id: undefined }));
      const superAdmin = await create(valid({ role: ROLES.SUPER_ADMIN, office_id: undefined }));
      assert.equal(executive.response.status, 201);
      assert.equal(superAdmin.response.status, 201);
    } finally {
      catalogue.down = false;
    }
  });

  it('AC7: Office Head, Office Staff and Executive get 403 (and anonymous callers 401)', async () => {
    for (const token of [tokens.head, tokens.staff, tokens.exec]) {
      assert.equal((await createRoute(req('POST', '/accounts', { token, body: valid() }))).status, 403);
      assert.equal((await listRoute(req('GET', '/accounts', { token }))).status, 403);
    }
    assert.equal((await createRoute(req('POST', '/accounts', { body: valid() }))).status, 401);
  });

  it('AC8: there is no Citizen role', async () => {
    const { response, body } = await create(valid({ role: 'citizen', office_id: undefined }));
    assert.equal(response.status, 400);
    assert.ok(body.error.details.role);
    await assert.rejects(
      ds.query(`INSERT INTO accounts (account_id, employee_no, full_name, email, password_hash, role_key) VALUES (gen_random_uuid(), 'CIT-1', 'Cit', 'cit@x.ph', 'x', 'citizen')`),
      /violates check constraint/,
    );
  });

  it('AC9: the list can be searched by name and filtered by role and office', async () => {
    await create(valid({ full_name: 'Zebulon Quartz', role: ROLES.OFFICE_HEAD, office_id: OFFICE_B }));
    await create(valid({ full_name: 'Zelda Quartz', role: ROLES.OFFICE_STAFF, office_id: OFFICE_B }));
    const get = async (query) => (await (await listRoute(req('GET', `/accounts?${query}`, { token: tokens.admin }))).json());

    const byName = await get('q=quartz');
    assert.equal(byName.items.length, 2);
    const byRole = await get(`q=quartz&role=${ROLES.OFFICE_HEAD}`);
    assert.deepEqual(byRole.items.map((a) => a.full_name), ['Zebulon Quartz']);
    const byOffice = await get(`q=quartz&office_id=${OFFICE_B}`);
    assert.equal(byOffice.items.length, 2);
    const none = await get(`q=quartz&office_id=${OFFICE_A}`);
    assert.equal(none.items.length, 0);
    const paged = await get('q=quartz&page_size=1&page=2');
    assert.equal(paged.total, 2);
    assert.equal(paged.items.length, 1);
    assert.equal((await listRoute(req('GET', '/accounts?role=citizen', { token: tokens.admin }))).status, 400);
  });

  it('validates required fields and the email format', async () => {
    const { response, body } = await create({ role: ROLES.EXECUTIVE, email: 'nope', password: 'short' });
    assert.equal(response.status, 400);
    const fields = Object.keys(body.error.details);
    for (const f of ['employee_no', 'full_name', 'email', 'password']) assert.ok(fields.includes(f), `${f} should be reported`);
  });

  it('records ACCOUNT_CREATED with the after-value and never the password hash', async () => {
    const { body } = await create(valid());
    const id = body.account.account_id;
    const event = (await outboxEvents(ds, 'ACCOUNT_CREATED')).find((e) => e.entity_id === id);
    assert.equal(event.actor_user_id, admin.accountId);
    assert.equal(event.actor_role, ROLES.SUPER_ADMIN);
    assert.equal(event.before_value, null);
    assert.equal(event.after_value.email, body.account.email);
    assert.equal(event.office_id, OFFICE_A);
    assert.ok(!JSON.stringify(event).includes('scrypt'), 'audit entry must not contain the password hash');
    assert.ok(!JSON.stringify(event).toLowerCase().includes('password'));
  });
});

describe('CC002 edit, deactivate and reset', () => {
  it('AC1: valid edits are saved with a before/after audit entry', async () => {
    const { body: created } = await create(valid({ full_name: 'Before Name' }));
    const id = created.account.account_id;
    const { response, body } = await update(id, { ...valid(), employee_no: created.account.employee_no, email: created.account.email, full_name: 'After Name', role: ROLES.OFFICE_HEAD, office_id: OFFICE_B });
    assert.equal(response.status, 200);
    assert.equal(body.account.full_name, 'After Name');
    assert.equal(body.account.office_id, OFFICE_B);
    const event = (await outboxEvents(ds, 'ACCOUNT_UPDATED')).find((e) => e.entity_id === id);
    assert.equal(event.before_value.full_name, 'Before Name');
    assert.equal(event.after_value.full_name, 'After Name');
    assert.equal(event.before_value.role, ROLES.OFFICE_STAFF);
    assert.equal(event.after_value.role, ROLES.OFFICE_HEAD);
  });

  it('AC2: changing Office Staff to Executive while keeping the office is rejected with the CC001 message', async () => {
    const { body: created } = await create(valid());
    const { response, body } = await update(created.account.account_id, { ...valid(), employee_no: created.account.employee_no, email: created.account.email, role: ROLES.EXECUTIVE, office_id: OFFICE_A });
    assert.equal(response.status, 400);
    assert.equal(body.error.message, 'Executive and Super Admin accounts cannot have an office');
  });

  it('editing a name does not need Catalogue, and email/employee duplicates are still refused', async () => {
    const { body: a } = await create(valid());
    const { body: b } = await create(valid());
    catalogue.down = true;
    try {
      const same = { employee_no: a.account.employee_no, email: a.account.email, role: a.account.role, office_id: a.account.office_id };
      assert.equal((await update(a.account.account_id, { ...same, full_name: 'Renamed While Catalogue Down' })).response.status, 200);
      const moved = await update(a.account.account_id, { ...same, full_name: 'X', office_id: OFFICE_B });
      assert.equal(moved.response.status, 503);
    } finally {
      catalogue.down = false;
    }
    const clash = await update(a.account.account_id, { employee_no: a.account.employee_no, full_name: 'X', email: b.account.email, role: a.account.role, office_id: a.account.office_id });
    assert.equal(clash.response.status, 409);
    assert.equal(clash.body.error.message, 'Email already in use');
  });

  it('AC3: a deactivated account cannot sign in and its session cannot be refreshed', async () => {
    const { body: created } = await create(valid({ password: 'Secret-Pass-1' }));
    const { account } = created;
    const session = await login(account.email, 'Secret-Pass-1');
    assert.equal(session.status, 200);
    const refreshToken = refreshTokenFrom(session);

    const off = await patch(deactivateRoute, account.account_id, 'deactivate');
    assert.equal((await off.json()).account.is_active, false);

    const again = await login(account.email, 'Secret-Pass-1');
    assert.equal(again.status, 401);
    assert.equal((await again.json()).error.message, 'Incorrect email or password');
    const refreshed = await refreshRoute(req('POST', '/auth/refresh', { cookie: `ccms_refresh=${refreshToken}` }));
    assert.equal(refreshed.status, 401);
    const event = (await outboxEvents(ds, 'ACCOUNT_DEACTIVATED')).find((e) => e.entity_id === account.account_id);
    assert.equal(event.after_value.is_active, false);
  });

  it('AC4: a reactivated account can sign in again', async () => {
    const { body: created } = await create(valid({ password: 'Secret-Pass-2' }));
    const id = created.account.account_id;
    await patch(deactivateRoute, id, 'deactivate');
    const on = await patch(reactivateRoute, id, 'reactivate');
    assert.equal((await on.json()).account.is_active, true);
    assert.equal((await login(created.account.email, 'Secret-Pass-2')).status, 200);
    assert.ok((await outboxEvents(ds, 'ACCOUNT_REACTIVATED')).some((e) => e.entity_id === id));
  });

  it('AC5: the last active Super Admin cannot be deactivated or re-roled (409)', async () => {
    // Only "root" is an active Super Admin right now besides those created in earlier tests; isolate by counting.
    await ds.query(`UPDATE accounts SET is_active = false WHERE role_key = 'super_admin' AND account_id <> $1`, [admin.accountId]);

    const deactivate = await patch(deactivateRoute, admin.accountId, 'deactivate');
    assert.equal(deactivate.status, 409);
    assert.equal((await deactivate.json()).error.message, 'At least one active Super Admin is required');
    const reRole = await update(admin.accountId, { employee_no: admin.employeeNo, full_name: admin.fullName, email: admin.email, role: ROLES.EXECUTIVE });
    assert.equal(reRole.response.status, 409);
    assert.equal(reRole.body.error.message, 'At least one active Super Admin is required');

    // With a second active Super Admin, one of them can step down, but never both.
    const { body: second } = await create(valid({ role: ROLES.SUPER_ADMIN, office_id: undefined }));
    assert.equal((await patch(deactivateRoute, second.account.account_id, 'deactivate')).status, 200);
    assert.equal((await patch(deactivateRoute, admin.accountId, 'deactivate')).status, 409);
  });

  it('AC5: two concurrent deactivations of the last two Super Admins cannot both succeed', async () => {
    await ds.query(`UPDATE accounts SET is_active = false WHERE role_key = 'super_admin' AND account_id <> $1`, [admin.accountId]);
    const { body: second } = await create(valid({ role: ROLES.SUPER_ADMIN, office_id: undefined }));
    const results = await Promise.all([
      patch(deactivateRoute, admin.accountId, 'deactivate'),
      patch(deactivateRoute, second.account.account_id, 'deactivate'),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM accounts WHERE role_key = 'super_admin' AND is_active`);
    assert.equal(n, 1);
    await ds.query(`UPDATE accounts SET is_active = true WHERE account_id = $1`, [admin.accountId]);
  });

  describe('password reset', () => {
    const tokenFromEmail = (message) => decodeURIComponent(/token=([^\s"&]+)/.exec(message.text)[1]);

    it('AC6: emails a link; after reset the old password fails and the new one works; audited without passwords', async () => {
      const { body: created } = await create(valid({ password: 'Old-Password-1' }));
      const { account } = created;
      const oldSession = await login(account.email, 'Old-Password-1');
      const oldRefresh = refreshTokenFrom(oldSession);

      mail.sent.length = 0;
      const requested = await resetRoute(req('POST', `/accounts/${account.account_id}/reset-password`, { token: tokens.admin }), ctx(account.account_id));
      assert.equal(requested.status, 200);
      assert.equal(mail.sent.length, 1);
      assert.equal(mail.sent[0].to, account.email);
      assert.match(mail.sent[0].text, /\/reset-password\?token=/);
      const token = tokenFromEmail(mail.sent[0]);

      const [stored] = await ds.query('SELECT token_hash FROM password_reset_tokens WHERE account_id = $1 AND used_at IS NULL', [account.account_id]);
      assert.notEqual(stored.token_hash, token, 'the reset token is stored hashed');

      const confirm = (t, pw) => confirmResetRoute(req('POST', '/auth/password-reset/confirm', { body: { token: t, new_password: pw } }));
      assert.equal((await confirm(token, 'short')).status, 400);
      assert.equal((await confirm(token, 'New-Password-2')).status, 200);

      assert.equal((await login(account.email, 'Old-Password-1')).status, 401);
      assert.equal((await login(account.email, 'New-Password-2')).status, 200);
      const refreshed = await refreshRoute(req('POST', '/auth/refresh', { cookie: `ccms_refresh=${oldRefresh}` }));
      assert.equal(refreshed.status, 401, 'sessions started before the reset are revoked');

      const reused = await confirm(token, 'Another-Password-3');
      assert.equal(reused.status, 400);
      assert.equal((await reused.json()).error.code, 'RESET_LINK_INVALID');

      const done = (await outboxEvents(ds, 'PASSWORD_RESET')).find((e) => e.entity_id === account.account_id);
      assert.equal(done.actor_user_id, account.account_id);
      const requestedEvent = (await outboxEvents(ds, 'PASSWORD_RESET_REQUESTED')).find((e) => e.entity_id === account.account_id);
      assert.equal(requestedEvent.actor_user_id, admin.accountId);
      for (const event of [done, requestedEvent]) {
        const serialised = JSON.stringify(event);
        assert.ok(!serialised.includes('New-Password-2') && !serialised.includes('Old-Password-1') && !serialised.includes(token));
      }
    });

    it('AC6: an expired link is refused', async () => {
      const { body: created } = await create(valid({ password: 'Old-Password-1' }));
      const id = created.account.account_id;
      mail.sent.length = 0;
      await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token: tokens.admin }), ctx(id));
      const token = tokenFromEmail(mail.sent[0]);
      await ds.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE account_id = $1`, [id]);
      const response = await confirmResetRoute(req('POST', '/auth/password-reset/confirm', { body: { token, new_password: 'Brand-New-Pass-1' } }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.message, 'This reset link is invalid or has expired');
      assert.equal((await login(created.account.email, 'Old-Password-1')).status, 200, 'the old password still works');
    });

    it('a newer link replaces the earlier one, and unknown tokens are refused', async () => {
      const { body: created } = await create(valid());
      const id = created.account.account_id;
      mail.sent.length = 0;
      await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token: tokens.admin }), ctx(id));
      await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token: tokens.admin }), ctx(id));
      const [first, second] = mail.sent.map(tokenFromEmail);
      const attempt = (t) => confirmResetRoute(req('POST', '/auth/password-reset/confirm', { body: { token: t, new_password: 'Valid-Password-9' } }));
      assert.equal((await attempt(first)).status, 400);
      assert.equal((await attempt('made-up-token')).status, 400);
      assert.equal((await attempt(second)).status, 200);
    });

    it('does not reset inactive accounts, and reports an email failure without a stack trace', async () => {
      const { body: created } = await create(valid());
      const id = created.account.account_id;
      mail.failNext = true;
      const failed = await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token: tokens.admin }), ctx(id));
      assert.equal(failed.status, 502);
      const text = await failed.text();
      assert.equal(JSON.parse(text).error.code, 'EMAIL_DELIVERY_FAILED');
      assert.ok(!text.includes('mail provider down'));

      await patch(deactivateRoute, id, 'deactivate');
      const inactive = await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token: tokens.admin }), ctx(id));
      assert.equal(inactive.status, 409);
    });
  });

  it('AC7: Office Head, Office Staff and Executive get 403 on every account change', async () => {
    const { body: created } = await create(valid());
    const id = created.account.account_id;
    for (const token of [tokens.head, tokens.staff, tokens.exec]) {
      assert.equal((await putRoute(req('PUT', `/accounts/${id}`, { token, body: valid() }), ctx(id))).status, 403);
      assert.equal((await patch(deactivateRoute, id, 'deactivate', token)).status, 403);
      assert.equal((await patch(reactivateRoute, id, 'reactivate', token)).status, 403);
      assert.equal((await resetRoute(req('POST', `/accounts/${id}/reset-password`, { token }), ctx(id))).status, 403);
    }
  });

  it('returns 404 for unknown accounts', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    assert.equal((await getRoute(req('GET', `/accounts/${id}`, { token: tokens.admin }), ctx(id))).status, 404);
    assert.equal((await getRoute(req('GET', '/accounts/nope', { token: tokens.admin }), ctx('nope'))).status, 404);
  });
});
