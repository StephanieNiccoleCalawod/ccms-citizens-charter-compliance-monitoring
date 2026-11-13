// CC055 notification bell: rules, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { getNotificationFeeds, markNotificationsRead } from '../../src/lib/api/notifications.js';
import { badgeText, hasBell, markedAsRead, mergeNotifications, unreadItems } from '../../src/lib/ui/notifications.js';

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
