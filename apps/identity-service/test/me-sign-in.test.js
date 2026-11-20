import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { GET as meRoute } from '../src/app/api/me/route.js';
import { NO_PASSWORD_MARKER } from '../src/lib/accounts.js';
import { getMe } from '../src/lib/me.js';
import { req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

// S8-04: /me says how the caller can sign in, so My Account can hide the password form for a Clerk-only account.
let env;
let ds;
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
});
after(() => env?.cleanup());

const me = async (account) => meRoute(req('GET', '/me', { token: await tokenFor(account) }));
const link = (account) =>
  ds.query('INSERT INTO account_clerk_links (account_id, clerk_issuer, clerk_user_id, linked_by) VALUES ($1, $2, $3, $4)', [
    account.accountId, 'https://example.clerk.test', `user_${account.accountId.replaceAll('-', '').slice(0, 20)}`, account.accountId,
  ]);

describe('S8-04 /me sign_in', () => {
  it('a password account that is not linked: password yes, Clerk no', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    const res = await me(account);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).sign_in, { clerk_linked: false, has_password: true });
  });

  it('a Clerk-only account (no CCCMS password): Clerk yes, password no', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    await ds.query('UPDATE accounts SET password_hash = $1 WHERE account_id = $2', [NO_PASSWORD_MARKER, account.accountId]);
    await link(account);
    assert.deepEqual((await (await me(account)).json()).sign_in, { clerk_linked: true, has_password: false });
  });

  it('a linked account that still has a password (dual mode): both yes', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_HEAD });
    await link(account);
    assert.deepEqual((await (await me(account)).json()).sign_in, { clerk_linked: true, has_password: true });
  });

  it('the existing parts of the answer are unchanged and no secret is added', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    const body = await (await me(account)).json();
    assert.deepEqual(Object.keys(body), ['account', 'what_i_can_do', 'sign_in']);
    assert.equal(body.account.account_id, account.accountId);
    assert.ok(Array.isArray(body.what_i_can_do));
    assert.ok(!JSON.stringify(body).includes(account.passwordHash));
  });

  it('if the link lookup fails, /me still answers and says it is unknown', async () => {
    const account = await seedAccount(ds, { role: ROLES.OFFICE_STAFF });
    const wrapped = new Proxy(ds, {
      get: (target, prop) => (prop === 'query' ? async (sql, params) => { if (String(sql).includes('account_clerk_links')) throw new Error('relation missing'); return target.query(sql, params); } : Reflect.get(target, prop)),
    });
    const body = await getMe(wrapped, { id: account.accountId });
    assert.equal(body.sign_in.clerk_linked, null);
    assert.equal(body.sign_in.has_password, true);
  });
});
