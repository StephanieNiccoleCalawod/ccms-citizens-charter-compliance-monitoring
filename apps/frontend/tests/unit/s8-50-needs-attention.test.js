import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { attentionItems, canSeeAttention, kindStyle } from '../../src/lib/ui/notifications.js';

const items = [
  { key: 'many_high_risk:office', kind: 'MANY_HIGH_RISK', text: '6 open requests are likely to be late today.' },
  { key: 'volume:o1:2026-11-25', kind: 'VOLUME', text: 'Many more requests than usual today.' },
  { key: 'overdue:t1', kind: 'OVERDUE', text: 'x' },
];

describe('S8-50 Needs attention', () => {
  it('only the Office Head and Super Admin see it', () => {
    assert.equal(canSeeAttention(ROLES.OFFICE_HEAD), true);
    assert.equal(canSeeAttention(ROLES.SUPER_ADMIN), true);
    for (const r of [ROLES.OFFICE_STAFF, ROLES.EXECUTIVE]) assert.deepEqual(attentionItems(items, r), []);
  });
  it('keeps only the unusual-case notices, each with one sentence and one real action', () => {
    const out = attentionItems(items, ROLES.OFFICE_HEAD);
    assert.deepEqual(out.map((i) => i.kind), ['MANY_HIGH_RISK', 'VOLUME']);
    for (const i of out) { assert.ok(i.text && i.action && i.href.startsWith('/')); }
  });
  it('the bell knows the two new kinds', () => {
    assert.equal(kindStyle('VOLUME').label, 'Busy Day Notification');
    assert.equal(kindStyle('MANY_HIGH_RISK').label, 'Many Likely Late Notification');
  });
});
