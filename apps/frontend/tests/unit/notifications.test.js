// CC055 notification bell: rules, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { getNotificationFeeds, markNotificationsRead } from '../../src/lib/api/notifications.js';
import { badgeText, chunkKeys, hasBell, kindStyle, markedAsRead, mergeNotifications, unavailableMessage, unreadItems, withLastGood } from '../../src/lib/ui/notifications.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const ok = (value) => ({ status: 'fulfilled', value });
const bad = { status: 'rejected', reason: new Error('x') };

describe('who has a bell', () => {
  it('everyone but the Executive', () => {
    assert.equal(hasBell(ROLES.SUPER_ADMIN), true); assert.equal(hasBell(ROLES.OFFICE_HEAD), true); assert.equal(hasBell(ROLES.OFFICE_STAFF), true);
    assert.equal(hasBell(ROLES.EXECUTIVE), false);
    assert.match(read('src/components/layout/AppShell.js'), /hasBell\(user\.role\) \? <NotificationBell \/>/);
  });
});

describe('calls', () => {
  it('read both feeds, and mark keys read in Oversight', async () => {
    const calls = [];
    const f = async (path, init) => { calls.push([path, init?.method ?? 'GET', init?.body]); return {}; };
    await getNotificationFeeds(f);
    await markNotificationsRead(['a:b'], f);
    assert.deepEqual(calls, [['/api/logs/analytics/notifications', 'GET', undefined], ['/api/operations/notifications', 'GET', undefined], ['/api/logs/analytics/notifications/read', 'POST', { keys: ['a:b'] }]]);
  });
  it('one feed failing does not hide the other', async () => {
    const f = async (path) => { if (path.includes('operations')) throw new Error('down'); return { items: [] }; };
    const feeds = await getNotificationFeeds(f);
    assert.equal(feeds.oversight.status, 'fulfilled'); assert.equal(feeds.operations.status, 'rejected');
  });
});

describe('merging', () => {
  const ops = ok({ items: [{ key: 'high_risk:1', kind: 'HIGH_RISK' }, { key: 'overdue:2', kind: 'OVERDUE' }, { key: 'deadline:3', kind: 'DEADLINE' }] });
  const over = ok({ items: [{ key: 'calendar:old', kind: 'CALENDAR', at: '2026-11-01T00:00:00Z', read: false }, { key: 'complaint:new', kind: 'COMPLAINT', at: '2026-11-12T00:00:00Z', read: false }], read_keys: ['overdue:2'] });
  it('puts overdue, then deadline, then high risk first, then the rest newest first; Operations items take their read state from Oversight', () => {
    const out = mergeNotifications({ oversight: over, operations: ops });
    assert.deepEqual(out.items.map((i) => i.key), ['overdue:2', 'deadline:3', 'high_risk:1', 'complaint:new', 'calendar:old']);
    assert.equal(out.items[0].read, true); assert.equal(out.items[1].read, false); assert.equal(out.partial, false);
  });
  it('shows what it has and says some could not load', () => {
    const out = mergeNotifications({ oversight: bad, operations: ops });
    assert.equal(out.items.length, 3); assert.equal(out.partial, true);
    assert.equal(mergeNotifications({ oversight: bad, operations: bad }).items.length, 0);
  });
  it('counts unread, caps the badge, and marks locally', () => {
    const { items } = mergeNotifications({ oversight: over, operations: ops });
    assert.equal(unreadItems(items).length, 4);
    assert.equal(unreadItems(markedAsRead(items, ['deadline:3'])).length, 3);
    assert.equal(badgeText(7), '7'); assert.equal(badgeText(120), '99+');
  });
});

describe('read marks and outages', () => {
  const ops = ok({ items: [{ key: 'overdue:2', kind: 'OVERDUE' }, { key: 'deadline:3', kind: 'DEADLINE' }] });
  const over = ok({ items: [{ key: 'complaint:new', kind: 'COMPLAINT', at: '2026-11-12T00:00:00Z', read: false }], read_keys: [] });
  it('a poll that lands before the save is confirmed does not turn a marked notice back to unread', () => {
    const out = mergeNotifications({ oversight: over, operations: ops }, { pendingReadKeys: new Set(['overdue:2', 'complaint:new']) });
    assert.deepEqual(out.items.map((i) => [i.key, i.read]), [['overdue:2', true], ['deadline:3', false], ['complaint:new', true]]);
  });
  it('a feed that fails keeps its last good notices and read marks, and is reported', () => {
    const first = withLastGood({ oversight: ok({ items: [], read_keys: ['overdue:2'] }), operations: ops }, {});
    assert.deepEqual(first.failed, []);
    const next = withLastGood({ oversight: bad, operations: bad }, first.good);
    assert.deepEqual(next.failed, ['oversight', 'operations']);
    const out = mergeNotifications(next.feeds);
    assert.deepEqual(out.items.map((i) => [i.key, i.read]), [['overdue:2', true], ['deadline:3', false]]);
  });
  it('a feed that fails with nothing earlier gives an empty feed, not an error', () => {
    const out = withLastGood({ oversight: bad, operations: ops }, {});
    assert.deepEqual(out.failed, ['oversight']);
    assert.equal(mergeNotifications(out.feeds).items.length, 2);
  });
  it('says which notices could not be loaded', () => {
    assert.equal(unavailableMessage([]), '');
    assert.match(unavailableMessage(['operations']), /^Deadline and late-risk notices could not be loaded/);
    assert.match(unavailableMessage(['oversight']), /^Complaint and calendar notices could not be loaded/);
    assert.match(unavailableMessage(['oversight', 'operations']), /^Notifications could not be loaded/);
  });
  it('splits "mark all" into calls of at most 200 keys', () => {
    const keys = Array.from({ length: 450 }, (_, i) => `k:${i}`);
    assert.deepEqual(chunkKeys(keys).map((c) => c.length), [200, 200, 50]);
    assert.deepEqual(chunkKeys([]), []);
  });
});

describe('bell source', () => {
  const src = read('src/components/notifications/NotificationBell.js') + read('src/components/notifications/NotificationPanel.js'); // the panel markup lives in its own file
  it('gives focus back to the bell on Escape and links the button to its panel', () => {
    assert.match(src, /e\.key === 'Escape'\) \{ setOpen\(false\); button\.current\?\.focus\(\)/);
    assert.match(src, /aria-controls=\{open \? 'notification-panel'/);
    assert.match(src, /id="notification-panel"/);
  });
  it('marks in batches, not just the first 200', () => {
    assert.match(src, /chunkKeys\(keys\)/);
    assert.doesNotMatch(src, /keys\.slice\(0, 200\)/);
  });
});

describe('how each kind looks', () => {
  it('has one colour per kind, as agreed', () => {
    const colors = { DEADLINE: '#3B82F6', OVERDUE: '#EF4444', HIGH_RISK: '#F97316', COMPLAINT: '#22C55E', CALENDAR: '#8B5CF6' };
    for (const [kind, color] of Object.entries(colors)) { assert.equal(kindStyle(kind).color, color); assert.match(kindStyle(kind).label, /Notification$/); }
  });
  it('falls back to a neutral look for a kind it does not know', () => {
    const look = kindStyle('SOMETHING_NEW');
    assert.equal(look.icon, 'bell'); assert.equal(look.label, 'SOMETHING_NEW');
  });
  it('the bell draws each item with its kind style', () => {
    assert.match(read('src/components/notifications/NotificationPanel.js'), /kindStyle\(item\.kind\)/);
  });
});
