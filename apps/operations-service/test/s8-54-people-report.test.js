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
