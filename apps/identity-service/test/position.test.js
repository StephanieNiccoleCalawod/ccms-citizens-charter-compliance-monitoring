// CC046: staff position or designation (label only).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { createTestDatabase } from 'ccms-shared/testing';
import { GET as listRoute, POST as createRoute } from '../src/app/api/accounts/route.js';
import { PUT as putRoute } from '../src/app/api/accounts/[id]/route.js';
import { PATCH as deactivateRoute } from '../src/app/api/accounts/[id]/deactivate/route.js';
import { PATCH as reactivateRoute } from '../src/app/api/accounts/[id]/reactivate/route.js';
import { GET as internalRoute } from '../src/app/api/internal/accounts/[id]/route.js';
import { migrateSprint5Identity } from '../src/lib/migrations/sprint5.js';
import { OFFICE_A, PASSWORD, ctx, outboxEvents, req, seedAccount, setupTestEnv, tokenFor } from './helpers.js';

let env;
let ds;
const tokens = {};
before(async () => {
  env = await setupTestEnv();
  ds = env.ds;
  tokens.admin = await tokenFor(await seedAccount(ds, { role: ROLES.SUPER_ADMIN }));
  tokens.head = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_HEAD }));
  tokens.staff = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_STAFF }));
});
after(() => env?.cleanup());

const valid = (over = {}) => ({
  employee_no: `E-${Math.random().toString(36).slice(2, 8)}`,
  full_name: 'Ana Cruz',
  email: `ana.${Math.random().toString(36).slice(2, 8)}@pup.edu.ph`,
  role: ROLES.OFFICE_STAFF,
  office_id: OFFICE_A,
  password: PASSWORD,
  ...over,
});
const create = async (body, token = tokens.admin) => {
  const response = await createRoute(req('POST', '/accounts', { token, body }));
  return { response, body: await response.json() };
};
const update = async (id, body, token = tokens.admin) => {
  const response = await putRoute(req('PUT', `/accounts/${id}`, { token, body }), ctx(id));
  return { response, body: await response.json() };
};
const list = async (query) => (await (await listRoute(req('GET', `/accounts?${query}`, { token: tokens.admin }))).json()).items;
const editBody = (account, over = {}) => ({ employee_no: account.employee_no, full_name: account.full_name, email: account.email, role: account.role, office_id: account.office_id, ...over });

describe('CC046 position', () => {
  it('AC1: saves a position (trimmed, up to 100) and returns it; it is optional', async () => {
    const a = await create(valid({ position: '  Administrative Aide III  ' }));
    assert.equal(a.response.status, 201);
    assert.equal(a.body.account.position, 'Administrative Aide III');
    const b = await create(valid());
    assert.equal(b.body.account.position, null);
    const c = await create(valid({ position: 'x'.repeat(100) }));
    assert.equal(c.response.status, 201);
  });

  it('refuses more than 100 characters and non-text, naming the field', async () => {
    for (const position of ['x'.repeat(101), 5, {}]) {
      const r = await create(valid({ position }));
      assert.equal(r.response.status, 400);
      assert.ok(r.body.error.details.position, JSON.stringify(r.body));
    }
  });

  it('only a Super Admin can set it (create and edit are Super Admin only)', async () => {
    assert.equal((await create(valid({ position: 'Aide' }), tokens.head)).response.status, 403);
    assert.equal((await create(valid({ position: 'Aide' }), tokens.staff)).response.status, 403);
    const { body } = await create(valid());
    assert.equal((await update(body.account.account_id, editBody(body.account, { position: 'Aide' }), tokens.staff)).response.status, 403);
  });

  it('AC1/AC2: the accounts list shows it, and "aide" finds "Administrative Aide III" in any letter case', async () => {
    const { body } = await create(valid({ full_name: 'Zed Position Test', position: 'Administrative Aide III' }));
    const id = body.account.account_id;
    for (const query of ['position=aide', 'position=AIDE', 'position=Administrative%20Aide', 'q=aide']) {
      const found = await list(query);
      const hit = found.find((x) => x.account_id === id);
      assert.ok(hit, query);
      assert.equal(hit.position, 'Administrative Aide III');
    }
    assert.equal((await list('position=zzz-nobody')).length, 0);
  });

  it('a "%" or "_" in the filter is matched literally', async () => {
    await create(valid({ position: 'Clerk' }));
    assert.equal((await list('position=%25')).length, 0);
  });

  it('editing: a body without position leaves it unchanged; empty text clears it; new text replaces it', async () => {
    const { body } = await create(valid({ position: 'Clerk I' }));
    const id = body.account.account_id;
    assert.equal((await update(id, editBody(body.account, { full_name: 'Renamed' }))).body.account.position, 'Clerk I');
    assert.equal((await update(id, editBody(body.account, { position: 'Clerk II' }))).body.account.position, 'Clerk II');
    assert.equal((await update(id, editBody(body.account, { position: '   ' }))).body.account.position, null);
  });

  it('AC4: the audit entries never contain the position, and no role or permission changes', async () => {
    const { body } = await create(valid({ position: 'SECRET-POSITION-LABEL' }));
    const id = body.account.account_id;
    await update(id, editBody(body.account, { position: 'SECRET-POSITION-LABEL-2' }));
    const events = [...(await outboxEvents(ds, 'ACCOUNT_CREATED')), ...(await outboxEvents(ds, 'ACCOUNT_UPDATED'))].filter((e) => e.entity_id === id);
    assert.equal(events.length, 2);
    assert.ok(!JSON.stringify(events).includes('SECRET-POSITION-LABEL'));
    assert.ok(!JSON.stringify(events).includes('position'));
    assert.equal((await update(id, editBody(body.account, { position: 'Head of Everything' }))).body.account.role, ROLES.OFFICE_STAFF);
  });

  it('the internal lookup needs the service key and returns only the position and the display name', async () => {
    const { body } = await create(valid({ position: 'Registrar II' }));
    const id = body.account.account_id;
    const call = (key, target = id) => internalRoute(req('GET', `/internal/accounts/${target}`, { headers: key ? { 'x-service-key': key } : {} }), ctx(target));
    assert.equal((await call(null)).status, 401);
    assert.equal((await call('wrong-key')).status, 401);
    const ok = await call('test-service-key-0123456789');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { account_id: id, full_name: 'Ana Cruz', position: 'Registrar II' });
    assert.equal((await call('test-service-key-0123456789', randomUUID())).status, 404);
    assert.equal((await call('test-service-key-0123456789', 'not-a-uuid')).status, 404);
  });

  it('a user token is not enough for the internal lookup', async () => {
    const { body } = await create(valid());
    const id = body.account.account_id;
    const response = await internalRoute(req('GET', `/internal/accounts/${id}`, { token: tokens.admin }), ctx(id));
    assert.equal(response.status, 401);
  });

  it('the database refuses an empty, untrimmed or over-long position', async () => {
    const { body } = await create(valid());
    for (const value of ['', '   ', ' Clerk', 'Clerk ', 'x'.repeat(101)]) {
      await assert.rejects(ds.query('UPDATE accounts SET position = $1 WHERE account_id = $2', [value, body.account.account_id]), (e) => e.code === '23514' || e.code === '22001');
    }
  });
});

describe('CC046 more rules', () => {
  it('a blank position on create is stored as none, and null clears an existing one', async () => {
    const blank = await create(valid({ position: '   ' }));
    assert.equal(blank.body.account.position, null);
    const { body } = await create(valid({ position: 'Clerk I' }));
    assert.equal((await update(body.account.account_id, editBody(body.account, { position: null }))).body.account.position, null);
  });

  it('an edit with a bad position is refused and leaves the saved one as it was', async () => {
    const { body } = await create(valid({ position: 'Clerk I' }));
    const id = body.account.account_id;
    for (const position of ['x'.repeat(101), 5, true, ['a'], {}]) {
      const r = await update(id, editBody(body.account, { position }));
      assert.equal(r.response.status, 400, JSON.stringify(position));
      assert.ok(r.body.error.details.position);
    }
    assert.equal((await update(id, editBody(body.account))).body.account.position, 'Clerk I');
  });

  it('the position filter works with the other filters and with paging, and "_" is matched literally', async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    await create(valid({ full_name: `Pg ${tag} One`, position: `Aide ${tag}`, role: ROLES.OFFICE_STAFF }));
    await create(valid({ full_name: `Pg ${tag} Two`, position: `Senior Aide ${tag}`, role: ROLES.OFFICE_STAFF }));
    await create(valid({ full_name: `Pg ${tag} Head`, position: `Aide ${tag}`, role: ROLES.OFFICE_HEAD }));
    const call = async (query) => (await (await listRoute(req('GET', `/accounts?${query}`, { token: tokens.admin }))).json());
    assert.equal((await call(`position=${tag}`)).total, 3);
    const paged = await call(`position=${tag}&page_size=2&page=2`);
    assert.deepEqual([paged.items.length, paged.total, paged.page, paged.page_size], [1, 3, 2, 2]);
    assert.equal((await call(`position=${tag}&role=${ROLES.OFFICE_HEAD}`)).total, 1);
    assert.equal((await call(`position=${tag}&status=inactive`)).total, 0);
    assert.equal((await call(`position=${tag}&q=Two`)).total, 1);
    assert.equal((await call('position=_')).total, 0);
  });

  it('only a Super Admin can read the accounts list, with or without the position filter', async () => {
    for (const token of [tokens.head, tokens.staff]) {
      assert.equal((await listRoute(req('GET', '/accounts?position=aide', { token }))).status, 403);
      assert.equal((await listRoute(req('GET', '/accounts', { token }))).status, 403);
    }
    assert.equal((await listRoute(req('GET', '/accounts?position=aide'))).status, 401);
  });

  it('the position never reaches any audit event: create, edit, deactivate and reactivate', async () => {
    const { body } = await create(valid({ position: 'SECRET-LABEL-XYZ' }));
    const id = body.account.account_id;
    await update(id, editBody(body.account, { position: 'SECRET-LABEL-XYZ-2' }));
    assert.equal((await deactivateRoute(req('PATCH', `/accounts/${id}/deactivate`, { token: tokens.admin }), ctx(id))).status, 200);
    assert.equal((await reactivateRoute(req('PATCH', `/accounts/${id}/reactivate`, { token: tokens.admin }), ctx(id))).status, 200);
    const rows = await ds.query("SELECT payload FROM audit_outbox WHERE payload::text LIKE $1", [`%${id}%`]);
    assert.ok(rows.length >= 4, 'create, edit, deactivate and reactivate were all recorded');
    assert.ok(!JSON.stringify(rows).includes('SECRET-LABEL'));
    assert.ok(!JSON.stringify(rows).includes('position'));
  });

  it('role and office rules are exactly as before: a position grants nothing and changes no rule', async () => {
    assert.equal((await create(valid({ role: ROLES.EXECUTIVE, office_id: OFFICE_A, position: 'Director' }))).response.status, 400);
    assert.equal((await create(valid({ role: ROLES.OFFICE_STAFF, office_id: null, position: 'Director' }))).response.status, 400);
    const exec = await create(valid({ role: ROLES.EXECUTIVE, office_id: null, position: 'Vice President' }));
    assert.equal(exec.response.status, 201);
    assert.equal(exec.body.account.role, ROLES.EXECUTIVE);
    const token = await tokenFor(await seedAccount(ds, { role: ROLES.OFFICE_STAFF }));
    assert.equal((await listRoute(req('GET', '/accounts', { token }))).status, 403, 'a position-sounding title does not unlock the list');
  });
});

describe('CC046 migration', () => {
  it('adds the column to an old table twice and leaves old accounts empty', async () => {
    const database = await createTestDatabase({ entities: [] });
    try {
      const old = database.dataSource;
      await old.query('CREATE TABLE accounts (account_id uuid PRIMARY KEY, full_name text)');
      await old.query(`INSERT INTO accounts VALUES ($1, 'Old Account')`, [randomUUID()]);
      await migrateSprint5Identity(old);
      await migrateSprint5Identity(old);
      assert.deepEqual(await old.query('SELECT full_name, position FROM accounts'), [{ full_name: 'Old Account', position: null }]);
    } finally {
      await database.drop();
    }
  });

  it('runs against a database that already has the column: tidies hand-written values, keeps good ones, and the rule then holds', async () => {
    const database = await createTestDatabase({ entities: [] });
    try {
      const old = database.dataSource;
      await old.query('CREATE TABLE accounts (account_id uuid PRIMARY KEY, full_name text, position varchar(100))');
      const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await old.query(`INSERT INTO accounts VALUES ($1,'A','  Clerk II  '), ($2,'B','   '), ($3,'C','Registrar'), ($4,'D',NULL)`, [a, b, c, d]);
      await migrateSprint5Identity(old);
      await migrateSprint5Identity(old);
      const rows = Object.fromEntries((await old.query('SELECT full_name, position FROM accounts')).map((r) => [r.full_name, r.position]));
      assert.deepEqual(rows, { A: 'Clerk II', B: null, C: 'Registrar', D: null });
      await assert.rejects(old.query("UPDATE accounts SET position = ' x' WHERE full_name = 'A'"), (e) => e.code === '23514');
    } finally {
      await database.drop();
    }
  });
});
