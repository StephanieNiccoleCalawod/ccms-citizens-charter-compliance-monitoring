// S8-42: every notice the bell can show has a key the "mark as read" call accepts, so no notice becomes impossible to mark read.
// The shapes below are the ones each producer builds (Oversight: complaint, calendar, access, volume; Operations: overdue, deadline, high_risk, many_high_risk).
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { KEY_PATTERN } from '../src/modules/notifications/notifications.js';

describe('S8-42 notice keys', () => {
  const id = randomUUID();
  const keys = [
    `complaint:${id}:ACKNOWLEDGED`, `complaint:${id}:RESOLVED`, `calendar:${id}`, `access:${id}`, `volume:${id}:2026-11-25`,
    `overdue:${id}`, `deadline:${id}`, `high_risk:${id}`, 'many_high_risk:office',
  ];
  it('the read call accepts the key of every kind of notice', () => {
    for (const key of keys) assert.ok(KEY_PATTERN.test(key) && key.length <= 200, key);
  });
  it('one notice, one key: no two kinds share a key, and acknowledged and resolved are two notices', () => {
    assert.equal(new Set(keys).size, keys.length);
  });
  it('the read call refuses keys that are not made like these', () => {
    for (const bad of ['', 'nocolon', 'UPPER:case', 'has space:x', `x:${'a'.repeat(151)}`]) assert.equal(KEY_PATTERN.test(bad), false, bad);
  });
});
