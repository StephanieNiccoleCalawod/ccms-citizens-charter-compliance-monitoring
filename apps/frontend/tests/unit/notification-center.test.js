// Settings > Notification Center: the bell's footer link, the page's rules and who may open it (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { FULL_CENTER_HREF, NOTICE_TABS, filterNotices, noticeCounts } from '../../src/lib/ui/notifications.js';
import { hubGroups } from '../../src/lib/ui/settings-hub.js';
import { ROLES } from 'ccms-shared/roles';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const items = [
  { key: 'a', kind: 'OVERDUE', text: 'Enrollment request is overdue', read: false },
  { key: 'b', kind: 'COMPLAINT', text: 'A complaint was filed', read: true },
  { key: 'c', kind: 'CALENDAR', text: 'Holiday on December 8', read: false },
  { key: 'd', kind: 'HIGH_RISK', text: 'Likely to finish late', read: true },
];

describe('Notification Center rules', () => {
  it('counts the four figures from the loaded notices', () => {
    assert.deepEqual(noticeCounts(items), { total: 4, unread: 2, deadlines: 2, updates: 2 });
    assert.deepEqual(noticeCounts([]), { total: 0, unread: 0, deadlines: 0, updates: 0 });
  });
  it('tabs and the search narrow the list, ignoring case', () => {
    assert.deepEqual(filterNotices(items, 'unread').map((i) => i.key), ['a', 'c']);
    assert.deepEqual(filterNotices(items, 'deadlines').map((i) => i.key), ['a', 'd']);
    assert.deepEqual(filterNotices(items, 'updates').map((i) => i.key), ['b', 'c']);
    assert.deepEqual(filterNotices(items, 'all', 'COMPLAINT').map((i) => i.key), ['b']);
    assert.deepEqual(filterNotices(items, 'unread', 'holiday').map((i) => i.key), ['c']);
    assert.deepEqual(filterNotices(items, 'all', '   ').length, 4);
    assert.deepEqual(filterNotices(items, 'nope').length, 4);
  });
  it('has the same four tabs as the bell', () => {
    assert.deepEqual(NOTICE_TABS.map((t) => t.id), ['all', 'unread', 'deadlines', 'updates']);
  });
});

describe('Notification Center wiring', () => {
  it('the bell panel has the Open Full Notification Center link and closes when it is used', () => {
    assert.equal(FULL_CENTER_HREF, '/settings/notifications');
    const panel = read('src/components/notifications/NotificationPanel.js');
    assert.match(panel, /Open Full Notification Center/);
    assert.match(panel, /href=\{FULL_CENTER_HREF\}/);
    assert.match(read('src/components/notifications/NotificationBell.js'), /onNavigate=\{\(\) => setOpen\(false\)\}/);
  });
  it('the page is only for roles that have a bell, and the hub links to it', () => {
    assert.match(read('src/app/settings/notifications/page.js'), /allowedRoles=\{BELL_ROLES\}/);
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) assert.ok(hubGroups(role).some((g) => g.links.some((l) => l.href === FULL_CENTER_HREF)), role);
    assert.ok(!hubGroups(ROLES.EXECUTIVE).some((g) => g.links.some((l) => l.href === FULL_CENTER_HREF)));
  });
  it('reads and saves the same feeds as the bell, and has no delete', () => {
    const page = read('src/components/notifications/NotificationCenter.js');
    assert.match(page, /getNotificationFeeds/);
    assert.match(page, /markNotificationsRead/);
    assert.doesNotMatch(page, /method: 'DELETE'|Clear All/);
  });
});

describe('Notice details window', () => {
  it('works out the rows from the notice itself', async () => {
    const { noticeDetails, noticePage } = await import('../../src/lib/ui/notifications.js');
    const complaint = { key: 'complaint:0b6c7c2e-3f0e-4c0a-9d58-2f1f6f6d8a11:RESOLVED', kind: 'COMPLAINT', text: 'Complaint CMP-20261119-J7KQ9T was resolved.', href: '/complaints' };
    assert.deepEqual(noticeDetails(complaint), [
      { label: 'Notice', value: 'Complaint Notification' }, { label: 'Status', value: 'Resolved' },
      { label: 'Complaint reference', value: 'CMP-20261119-J7KQ9T', mono: true }, { label: 'Where to see it', value: 'Complaint' },
    ]);
    const late = { key: 'overdue:t1', kind: 'OVERDUE', text: 'TX-0001 (Enrollment) has used all of its time limit.', href: '/transactions/t1' };
    const rows = noticeDetails(late);
    assert.deepEqual(rows.map((r) => r.label), ['Notice', 'Status', 'Tracking number', 'Service', 'Where to see it']);
    assert.equal(rows.find((r) => r.label === 'Service').value, 'Enrollment');
    assert.deepEqual(noticePage(late), { href: '/transactions/t1', label: 'Transaction' });
    assert.deepEqual(noticePage(complaint), { href: '/complaints?open=0b6c7c2e-3f0e-4c0a-9d58-2f1f6f6d8a11', label: 'Complaint' });
    assert.deepEqual(noticePage({ key: 'complaint:not-an-id:RESOLVED', kind: 'COMPLAINT', href: '/complaints' }), { href: '/complaints', label: 'Complaints' });
    assert.deepEqual(noticePage({ key: 'calendar:9', kind: 'CALENDAR', href: '/calendar' }), { href: '/calendar?tab=holidays', label: 'Holidays and suspensions' });
    assert.deepEqual(noticePage({ href: '/late-risk' }), { href: '/late-risk', label: 'Chance of finishing late' });
    assert.equal(noticePage({}), null);
    assert.ok(noticeDetails({ key: 'access:1', kind: 'ACCESS', text: 'x', href: '/access' }).some((r) => r.value === 'Access Notification'));
    assert.equal(noticeDetails({ key: 'k', kind: 'WHAT', text: 'x' }).length, 1); // an unknown kind still opens, with no page button
  });
  it('the Complaints and Calendar pages open what a notice points at', () => {
    assert.match(read('src/components/complaints/ComplaintsPage.js'), /get\('open'\)/);
    assert.match(read('src/app/calendar/page.js'), /get\('tab'\)/);
  });
  it('the bell and the Notification Center open it instead of leaving the page', () => {
    for (const f of ['NotificationBell', 'NotificationCenter']) assert.match(read(`src/components/notifications/${f}.js`), /<NoticeDetailModal item=\{detail\}/);
    assert.doesNotMatch(read('src/components/notifications/NotificationPanel.js'), /href=\{item\.href/);
    assert.doesNotMatch(read('src/components/notifications/NotificationCenter.js'), /href=\{item\.href/);
    const modal = read('src/components/notifications/NoticeDetailModal.js');
    assert.match(modal, /Open \{page\.label\}/);
    assert.match(modal, /data-testid="notice-delete"/); // the person asked for Delete: it always asks first (see notice-delete.test.js)
  });
});
