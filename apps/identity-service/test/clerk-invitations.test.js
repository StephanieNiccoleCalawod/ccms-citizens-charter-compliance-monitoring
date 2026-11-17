import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { ROLES } from 'ccms-shared';
import { DELETE as revokeRoute, POST as inviteRoute } from '../src/app/api/accounts/[id]/clerk-invitation/route.js';
import { PATCH as deactivateRoute } from '../src/app/api/accounts/[id]/deactivate/route.js';
import { POST as exchangeRoute, setExchangeLimiter } from '../src/app/api/auth/clerk/exchange/route.js';
import { GET as linksRoute } from '../src/app/api/clerk-access/links/route.js';
import { GET as requestsRoute } from '../src/app/api/clerk-access/requests/route.js';
import { setDirectoryFetch } from '../src/lib/clerk-directory.js';
import { ctx, outboxEvents, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

// Clerk sign-in, Flow A: CCCMS sends the invitation and links the account at the person's first sign-in by reading the
// opaque reference back from Clerk (Backend API). Clerk is a stand-in here: no network, no real key, test domains only (R8).
const ISSUER = 'https://example-instance-0000.clerk.accounts.dev';
const ORIGIN = 'http://localhost:3000';
const ENV = [
  'CLERK_AUTH_ENABLED', 'CLERK_ISSUER', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_INVITATIONS_ENABLED', 'CLERK_SECRET_KEY',
  'CLERK_DIRECTORY_ENABLED', 'CLERK_INVITATION_REDIRECT_URL', 'PUBLIC_BASE_URL',
];

let env;
let ds;
let key;

// The stand-in Clerk instance.
let users; // Clerk users
let invites; // Clerk invitations: { id, email_address, public_metadata, status, redirect_url }
let calls;
let failCreate;
let clerkDown;

before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  key = await generateKeyPair('RS256', { extractable: true });
});
after(() => env?.cleanup());

beforeEach(async () => {
  process.env.CLERK_AUTH_ENABLED = 'true';
  process.env.CLERK_ISSUER = ISSUER;
  process.env.CLERK_JWT_KEY = (await exportSPKI(key.publicKey)).replace(/\n/g, '\\n');
  process.env.CLERK_AUTHORIZED_PARTIES = ORIGIN;
  process.env.CLERK_INVITATIONS_ENABLED = 'true';
  process.env.CLERK_SECRET_KEY = 'sk_test_fake_for_tests_only';
  process.env.PUBLIC_BASE_URL = 'https://cms.example.test';
  setExchangeLimiter({ check: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
  users = [];
  invites = [];
  calls = [];
  failCreate = null;
  clerkDown = false;
  setDirectoryFetch(async (url, init = {}) => {
    if (clerkDown) return new Response('{}', { status: 500 });
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, search: u.search, body, auth: init.headers?.authorization });
    if (method === 'GET' && u.pathname === '/v1/users') {
      const wanted = (u.searchParams.get('email_address') ?? '').toLowerCase();
      return new Response(JSON.stringify(users.filter((x) => x.email_addresses.some((a) => a.email_address === wanted))), { status: 200 });
    }
    if (method === 'GET' && u.pathname.startsWith('/v1/users/')) {
      const user = users.find((x) => x.id === decodeURIComponent(u.pathname.split('/').pop()));
      return user ? new Response(JSON.stringify(user), { status: 200 }) : new Response('{}', { status: 404 });
    }
    if (method === 'POST' && u.pathname === '/v1/invitations') {
      if (failCreate) return new Response(JSON.stringify({ errors: [{ code: failCreate }] }), { status: 422 });
      const invite = { id: `inv_${invites.length + 1}${Date.now()}`, ...body, status: 'pending' };
      invites.push(invite);
      return new Response(JSON.stringify(invite), { status: 200 });
    }
    const revoke = /^\/v1\/invitations\/([^/]+)\/revoke$/.exec(u.pathname);
    if (method === 'POST' && revoke) {
      const invite = invites.find((i) => i.id === decodeURIComponent(revoke[1]));
      if (!invite || invite.status !== 'pending') return new Response('{}', { status: 400 });
      invite.status = 'revoked';
      return new Response(JSON.stringify(invite), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
});

afterEach(async () => {
  for (const name of ENV) delete process.env[name];
  setExchangeLimiter(null);
  setDirectoryFetch(null);
  await ds.query('DELETE FROM clerk_invitations');
  await ds.query('DELETE FROM account_clerk_links');
  await ds.query('DELETE FROM clerk_access_requests');
});

let seq = 0;
const newSubject = () => `user_flowa${Date.now()}${(seq += 1)}`;
const codeOf = async (response) => (await response.json()).error?.code;
const admin = async () => {
  const account = await seedAccount(ds, { role: ROLES.SUPER_ADMIN });
  return { account, token: await tokenFor(account) };
};
const invite = (token, account) => inviteRoute(req('POST', `/accounts/${account.accountId}/clerk-invitation`, { token }), ctx(account.accountId));
const revoke = (token, account) => revokeRoute(req('DELETE', `/accounts/${account.accountId}/clerk-invitation`, { token }), ctx(account.accountId));

async function clerkToken(sub) {
  return new SignJWT({ azp: ORIGIN, sid: 'sess_test123', v: 2, email: 'hint@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'ins_test' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('60s')
    .setSubject(sub)
    .sign(key.privateKey);
}
const exchange = async (sub) => exchangeRoute(req('POST', '/auth/clerk/exchange', { token: await clerkToken(sub) }));

/** The person accepts the invitation: Clerk creates their user, verified email, with the invitation metadata copied over. */
function accept(inv, { sub = newSubject(), verified = true, email = inv.email_address, banned = false } = {}) {
  inv.status = 'accepted';
  users.push({
    id: sub,
    first_name: 'New',
    last_name: 'Person',
    banned,
    locked: false,
    public_metadata: structuredClone(inv.public_metadata),
    email_addresses: [{ email_address: email, verification: { status: verified ? 'verified' : 'unverified' } }],
  });
  return sub;
}

describe('Clerk sign-in: Flow A (invitation sent by CCCMS)', () => {
  it('sends one invitation with only an opaque reference under public_metadata.cccms, and stores only its hash', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'New.Staff@example.test' });
    const res = await invite(token, staff);
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    assert.equal(invites.length, 1);
    const [sent] = invites;
    assert.equal(sent.email_address, 'new.staff@example.test');
    assert.equal(sent.redirect_url, 'https://cms.example.test/login/clerk');
    assert.deepEqual(Object.keys(sent.public_metadata), ['cccms'], 'only our key (R2)');
    assert.deepEqual(Object.keys(sent.public_metadata.cccms), ['invitation']);
    const ref = sent.public_metadata.cccms.invitation;
    assert.match(ref, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!JSON.stringify(sent).includes(staff.accountId), 'no account ID, role or name in Clerk');
    assert.ok(!JSON.stringify(sent).includes(staff.roleKey));
    const [row] = await ds.query('SELECT ref_hash, clerk_invitation_id FROM clerk_invitations WHERE account_id = $1', [staff.accountId]);
    assert.notEqual(row.ref_hash, ref);
    assert.equal(row.ref_hash.length, 64);
    assert.equal(row.clerk_invitation_id, sent.id);
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_INVITED')).find((e) => e.entity_id === staff.accountId);
    assert.deepEqual(event.after_value, { account_id: staff.accountId, clerk_invitation_id: sent.id });
    assert.ok(!JSON.stringify(event).includes('example.test'), 'audited by ID, no email');
    assert.ok(calls.every((c) => c.auth === 'Bearer sk_test_fake_for_tests_only'));
    assert.ok(!JSON.stringify(await res.json()).includes('sk_test'));
  });

  it('links the account at the first sign-in from the reference, once, and the person gets their CCMS role', async () => {
    const { account: inviter, token } = await admin();
    const staff = await seedAccount(ds, { role: ROLES.OFFICE_HEAD, email: 'head.a@example.test' });
    assert.equal((await invite(token, staff)).status, 201);
    const sub = accept(invites[0]);
    const signedIn = await exchange(sub);
    assert.equal(signedIn.status, 200, JSON.stringify(await signedIn.clone().json()));
    assert.equal((await signedIn.json()).user.role, ROLES.OFFICE_HEAD);
    const [link] = await ds.query('SELECT clerk_issuer, clerk_user_id, linked_by FROM account_clerk_links WHERE account_id = $1', [staff.accountId]);
    assert.deepEqual(link, { clerk_issuer: ISSUER, clerk_user_id: sub, linked_by: inviter.accountId });
    const [row] = await ds.query('SELECT used_at, used_by_clerk_user_id FROM clerk_invitations WHERE account_id = $1', [staff.accountId]);
    assert.ok(row.used_at);
    assert.equal(row.used_by_clerk_user_id, sub);
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_LINKED')).find((e) => e.entity_id === staff.accountId);
    assert.deepEqual(event.after_value, { account_id: staff.accountId, clerk_user_id: sub, via: 'invitation', invited_by: inviter.accountId });
    assert.equal((await requestsRoute(req('GET', '/clerk-access/requests', { token }))).status, 200);
    assert.equal((await (await requestsRoute(req('GET', '/clerk-access/requests', { token }))).json()).items.length, 0, 'never shown as pending');
    // Signing in again uses the binding; Clerk is not asked again.
    const before = calls.length;
    assert.equal((await exchange(sub)).status, 200);
    assert.equal(calls.length, before);
  });

  it('a reference is usable once: a second Clerk user carrying the same metadata gets "No access yet"', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'once@example.test' });
    await invite(token, staff);
    const first = accept(invites[0]);
    assert.equal((await exchange(first)).status, 200);
    // Another app with the instance key copies the reference onto someone else.
    const copy = accept({ ...invites[0], public_metadata: invites[0].public_metadata });
    const res = await exchange(copy);
    assert.equal(await codeOf(res), 'CCMS_ACCESS_PENDING');
  });

  it('a reference that CCCMS never issued, or a made-up one, links nothing', async () => {
    const sub = newSubject();
    const { token } = await admin();
    await invite(token, await seedAccount(ds, { email: 'someone@example.test' })); // an open invitation exists
    users.push({
      id: sub,
      banned: false,
      locked: false,
      public_metadata: { cccms: { invitation: 'x'.repeat(43) } },
      email_addresses: [{ email_address: 'someone@example.test', verification: { status: 'verified' } }],
    });
    assert.equal(await codeOf(await exchange(sub)), 'CCMS_ACCESS_PENDING');
    assert.equal((await ds.query('SELECT 1 FROM account_clerk_links')).length, 0);
  });

  it('needs the invited email as a VERIFIED address of the Clerk user, and refuses banned users', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'verify@example.test' });
    await invite(token, staff);
    const unverified = accept({ ...invites[0] }, { verified: false });
    assert.equal(await codeOf(await exchange(unverified)), 'CCMS_ACCESS_PENDING');
    const other = accept({ ...invites[0] }, { email: 'other@example.test' });
    assert.equal(await codeOf(await exchange(other)), 'CCMS_ACCESS_PENDING');
    const banned = accept({ ...invites[0] }, { banned: true });
    assert.equal(await codeOf(await exchange(banned)), 'CCMS_ACCESS_PENDING');
    // The invitation is still open for the right person.
    assert.equal((await exchange(accept(invites[0]))).status, 200);
  });

  it('a deactivated account is not linked, and a revoked invitation binds nothing', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'revoked@example.test' });
    await invite(token, staff);
    const res = await revoke(token, staff);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { account_id: staff.accountId, revoked_in_clerk: true });
    assert.equal(invites[0].status, 'revoked');
    const event = (await outboxEvents(ds, 'ACCOUNT_CLERK_INVITATION_REVOKED')).find((e) => e.entity_id === staff.accountId);
    assert.ok(event);
    assert.equal(await codeOf(await exchange(accept({ ...invites[0] }))), 'CCMS_ACCESS_PENDING');
    assert.equal(await codeOf(await revoke(token, staff)), 'CLERK_INVITATION_NOT_FOUND');

    const later = await seedAccount(ds, { email: 'later.off@example.test' });
    await invite(token, later);
    await deactivateRoute(req('PATCH', `/accounts/${later.accountId}/deactivate`, { token }), ctx(later.accountId));
    assert.equal(await codeOf(await exchange(accept(invites[1]))), 'CCMS_ACCESS_PENDING');
  });

  it('revoking stops CCMS honouring the invitation even when Clerk cannot be reached', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'down.revoke@example.test' });
    await invite(token, staff);
    const pending = invites[0];
    setDirectoryFetch(async () => { throw new TypeError('network'); });
    const res = await revoke(token, staff);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).revoked_in_clerk, false);
    const [row] = await ds.query('SELECT revoked_at FROM clerk_invitations WHERE account_id = $1', [staff.accountId]);
    assert.ok(row.revoked_at);
    assert.equal(pending.status, 'pending');
  });

  it('refuses to invite an email that already has a Clerk login (use Flow B), a linked or inactive account, or twice', async () => {
    const { token } = await admin();
    const existing = await seedAccount(ds, { email: 'has.login@example.test' });
    users.push({ id: 'user_has1', email_addresses: [{ email_address: 'has.login@example.test', verification: { status: 'verified' } }] });
    assert.equal(await codeOf(await invite(token, existing)), 'CLERK_USER_EXISTS');
    assert.equal(invites.length, 0);

    const inactive = await seedAccount(ds, { active: false });
    assert.equal(await codeOf(await invite(token, inactive)), 'ACCOUNT_INACTIVE');

    const staff = await seedAccount(ds, { email: 'twice.inv@example.test' });
    assert.equal((await invite(token, staff)).status, 201);
    assert.equal(await codeOf(await invite(token, staff)), 'CLERK_INVITATION_OPEN');
    assert.equal(invites.length, 1);
    assert.equal((await exchange(accept(invites[0]))).status, 200);
    assert.equal(await codeOf(await invite(token, staff)), 'ACCOUNT_ALREADY_LINKED');
  });

  it('reports a Clerk refusal as 409 and saves nothing', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'refused@example.test' });
    failCreate = 'duplicate_record';
    const res = await invite(token, staff);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'CLERK_INVITATION_REFUSED');
    assert.equal(body.error.details.clerk_code, 'duplicate_record');
    assert.equal((await ds.query('SELECT 1 FROM clerk_invitations')).length, 0);
  });

  it('Clerk being down at sign-in falls back to "No access yet", and the next try links', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'flaky@example.test' });
    await invite(token, staff);
    const sub = accept(invites[0]);
    clerkDown = true;
    assert.equal(await codeOf(await exchange(sub)), 'CCMS_ACCESS_PENDING');
    clerkDown = false;
    assert.equal((await exchange(sub)).status, 200);
  });

  it('asks Clerk nothing at sign-in while no invitation is open, and nothing at all while the switch is off', async () => {
    const sub = newSubject();
    assert.equal(await codeOf(await exchange(sub)), 'CCMS_ACCESS_PENDING');
    assert.equal(calls.length, 0);

    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'off@example.test' });
    process.env.CLERK_INVITATIONS_ENABLED = 'false';
    assert.equal((await invite(token, staff)).status, 404);
    assert.equal((await revoke(token, staff)).status, 404);
    const links = await (await linksRoute(req('GET', '/clerk-access/links', { token }))).json();
    assert.equal(links.invitations, false);
    assert.deepEqual(links.invited, []);
    process.env.CLERK_INVITATIONS_ENABLED = 'true';
    delete process.env.CLERK_SECRET_KEY;
    assert.equal(await codeOf(await invite(token, staff)), 'CLERK_INVITATIONS_NOT_CONFIGURED');
    assert.equal(calls.length, 0);
  });

  it('lists open invitations for the Super Admin, and only the Super Admin can invite or revoke', async () => {
    const { token } = await admin();
    const staff = await seedAccount(ds, { email: 'listed@example.test' });
    await invite(token, staff);
    const links = await (await linksRoute(req('GET', '/clerk-access/links', { token }))).json();
    assert.equal(links.invitations, true);
    assert.deepEqual(links.invited.map((i) => i.account_id), [staff.accountId]);
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) {
      const other = await tokenFor(await seedAccount(ds, { role }));
      assert.equal((await invite(other, staff)).status, 403);
      assert.equal((await revoke(other, staff)).status, 403);
    }
    assert.equal((await invite(null, staff)).status, 401);
  });
});
