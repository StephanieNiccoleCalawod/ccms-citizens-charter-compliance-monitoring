import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { notificationsFromRisk } from '../src/modules/notifications/notifications.js';

const high = (n) => Array.from({ length: n }, (_, i) => ({ transaction_id: `t${i}`, tracking_no: `2026-0000${i}`, service_name: 'Service', level: 'HIGH', working_minutes_left: 30, share_used: 0.5, can_open: true }));

describe('S8-50 (c) many likely-late at once', () => {
  it('Office Head gets one office notice, listed first, at 5 or more High-risk open requests', () => {
    const out = notificationsFromRisk(high(5), { role: ROLES.OFFICE_HEAD });
    assert.equal(out[0].kind, 'MANY_HIGH_RISK');
    assert.equal(out[0].count, 5);
    assert.equal(out.filter((n) => n.kind === 'MANY_HIGH_RISK').length, 1);
    assert.doesNotMatch(out[0].text, /HIGH|_/);
  });
  it('4 is not enough, and Office Staff never get it', () => {
    assert.ok(!notificationsFromRisk(high(4), { role: ROLES.OFFICE_HEAD }).some((n) => n.kind === 'MANY_HIGH_RISK'));
    assert.ok(!notificationsFromRisk(high(9), { role: ROLES.OFFICE_STAFF }).some((n) => n.kind === 'MANY_HIGH_RISK'));
  });
  it('overdue requests are not counted as High risk', () => {
    const items = high(5).map((i) => ({ ...i, working_minutes_left: 0 }));
    assert.ok(!notificationsFromRisk(items, { role: ROLES.OFFICE_HEAD }).some((n) => n.kind === 'MANY_HIGH_RISK'));
  });
});
