import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { fetchOfficePeople, parsePeopleReport, readPeopleReport } from '../src/modules/reports/people.js';

const office = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const person = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const user = { id: person, officeId: office, role: ROLES.OFFICE_STAFF };
const query = (over = {}) => new URLSearchParams({ office_id: office, from: '2026-10-01', to: '2026-10-31', ...over });
test('S8-54 D-AC-6 denies Executive, cross-office and other-person staff reports', () => {
  for (const [actor, params] of [[{ ...user, role: ROLES.EXECUTIVE }, query()], [user, query({ office_id: other })],
    [user, query({ scope: 'all_staff' })], [user, query({ scope: 'office' })], [user, query({ person_id: other })],
    [{ ...user, role: ROLES.OFFICE_HEAD }, query({ office_id: other })]]) {
    assert.throws(() => parsePeopleReport(params, actor), (e) => e.status === 403);
  }
  assert.equal(parsePeopleReport(query(), user).personId, person);
  assert.equal(parsePeopleReport(query({ office_id: other }), { ...user, role: ROLES.SUPER_ADMIN }).officeId, other);
});
test('S8-6x a Super Admin may leave the office out of a "Whole office" request, meaning every office; nobody else may', () => {
  const noOffice = () => new URLSearchParams({ from: '2026-10-01', to: '2026-10-31', scope: 'office' });
  const admin = { ...user, role: ROLES.SUPER_ADMIN, officeId: null }; // a real Super Admin is tied to no one office
  assert.equal(parsePeopleReport(noOffice(), admin).officeId, null);
  // Only the "office" (Whole office) scope may do this - a per-staff or per-person request still needs one office.
  for (const scope of ['all_staff', 'person']) {
    assert.throws(() => parsePeopleReport(new URLSearchParams({ from: '2026-10-01', to: '2026-10-31', scope }), admin), (e) => e.status === 400);
  }
  // An Office Head or Office Staff can never omit it - their own office fills in instead, never "every office".
  assert.equal(parsePeopleReport(noOffice(), { ...user, role: ROLES.OFFICE_HEAD }).officeId, office);
  assert.equal(parsePeopleReport(new URLSearchParams({ from: '2026-10-01', to: '2026-10-31' }), user).officeId, office);
});
test('S8-54 strict real dates and scope prevent silently broader filters', () => {
  for (const over of [{ from: '2026-02-30' }, { from: '0000-01-01' }, { from: '2026-11-01' }, { scope: 'everyone' }, { seeded: 'true' }]) {
    assert.throws(() => parsePeopleReport(query(over), user), (e) => e.status === 400);
  }
  assert.equal(parsePeopleReport(new URLSearchParams(), user, new Date('2026-11-23T16:05:00Z')).from, '2026-11-24');
});
test('S8-54 Office Head cannot request someone outside current office membership', async () => {
  await assert.rejects(readPeopleReport({ query: () => assert.fail('No database read before authorization') },
    { ...user, role: ROLES.OFFICE_HEAD }, query({ scope: 'person', person_id: other }), { roster: async () => [] }), (e) => e.status === 403);
});
test('S8-54 staff query is restricted in SQL and never requests the office roster', async () => {
  const response = await readPeopleReport({ query: async (_sql, args) => {
    assert.equal(args[0], office); assert.equal(args[3], person); assert.equal(args[4], null);
    assert.equal(args[2], '2026-10-31T16:00:00.000Z');
    return [{ is_total: true, handled: 0, excluded_seed_count: 2 }];
  } }, user, query(), { roster: () => assert.fail('Staff must not fetch other people') });
  assert.equal(response.items[0].person_id, person);
  assert.equal(response.items[0].linked_complaints, null);
  assert.equal(response.excluded_seed_count, 2);
  assert.match(response.note, /Seeded rows are excluded/);
});
test('S8-54 membership lookup fails closed on an unavailable or malformed Identity roster', async () => {
  const oldUrl = process.env.IDENTITY_URL, oldKey = process.env.SERVICE_KEY;
  process.env.IDENTITY_URL = 'http://identity/api'; process.env.SERVICE_KEY = 'test';
  try {
    for (const fetcher of [async () => new Response('{}', { status: 503 }), async () => new Response('{"items":[{}]}')]) {
      await assert.rejects(fetchOfficePeople(office, { fetcher }), (e) => e.code === 'REPORT_MEMBERSHIP_UNAVAILABLE');
    }
  } finally {
    if (oldUrl === undefined) delete process.env.IDENTITY_URL; else process.env.IDENTITY_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SERVICE_KEY; else process.env.SERVICE_KEY = oldKey;
  }
});

test('S8-54 complaints linked by tracking number are counted per person, and the total matches', async () => {
  const head = { ...user, role: ROLES.OFFICE_HEAD };
  const a = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const sqls = [];
  const db = { query: async (sql, args) => {
    sqls.push(sql);
    if (/upper\(t\.tracking_no\)=ANY/.test(sql)) {
      assert.deepEqual([...args[4]].sort(), ['T-1', 'T-2']);
      return [{ started_by: person, tracking_no: 'T-1' }, { started_by: person, tracking_no: 'T-2' }, { started_by: a, tracking_no: 'T-2' }];
    }
    return [{ is_total: true, handled: 3 }, { is_total: false, person_id: person, handled: 2 }, { is_total: false, person_id: a, handled: 1 }];
  } };
  const out = await readPeopleReport(db, head, query({ scope: 'all_staff' }), { roster: async () => [{ account_id: person, full_name: 'Ana' }, { account_id: a, full_name: 'Ben' }],
    complaintCounts: async () => new Map([['T-1', 1], ['T-2', 2]]) });
  const by = Object.fromEntries(out.items.map((i) => [i.person_name, i.linked_complaints]));
  assert.deepEqual(by, { Ana: 3, Ben: 2 });
  assert.equal(out.totals.linked_complaints, 5);
  assert.match(out.attribution.complaints, /counted by Oversight/);
});

test('S8-54 when Oversight cannot be asked the figure is null, never zero, and the note says so', async () => {
  const out = await readPeopleReport({ query: async () => [{ is_total: true, handled: 0 }] }, user, query(), { complaintCounts: async () => null });
  assert.equal(out.items[0].linked_complaints, null);
  assert.equal(out.totals.linked_complaints, null);
  assert.match(out.attribution.complaints, /not available/);
});

test('S8-54 the complaint count call is not made without OVERSIGHT_SERVICE_URL and the service key, and failures give null', async () => {
  const { fetchComplaintCounts } = await import('../src/modules/reports/people.js');
  assert.equal(await fetchComplaintCounts(office, { env: {}, fetcher: () => assert.fail('no call') }), null);
  const env = { OVERSIGHT_SERVICE_URL: 'http://oversight', SERVICE_KEY: 'k' };
  assert.equal(await fetchComplaintCounts(office, { env, fetcher: async () => new Response('{}', { status: 503 }) }), null);
  assert.equal(await fetchComplaintCounts(office, { env, fetcher: async () => { throw new Error('down'); } }), null);
  assert.equal(await fetchComplaintCounts(office, { env, fetcher: async () => new Response('{"items":[{"tracking_no":"x"}]}') }), null);
  const ok = await fetchComplaintCounts(office, { env, fetcher: async (url, init) => { assert.match(url, /\/internal\/complaint-links\?office_id=/); assert.equal(init.headers['x-service-key'], 'k'); return new Response('{"items":[{"tracking_no":"t-1","count":2}]}'); } });
  assert.equal(ok.get('T-1'), 2);
});
