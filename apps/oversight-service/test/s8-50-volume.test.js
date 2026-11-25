import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { volumeCheck, volumeNotices } from '../src/modules/notifications/volume.js';

const days = (counts, start = '2026-10-01') => counts.map((n, i) => ({ office_id: 'O1', day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), n }));
const usual = Array.from({ length: 24 }, (_, i) => 20 + (i % 5)); // 20..24 a day

describe('S8-50 (b) unusually many requests in a day', () => {
  it('flags a day above Q3 + 3 x IQR', () => {
    const r = volumeCheck(usual, 60);
    assert.equal(r.unusual, true); assert.ok(r.usual_max >= 24);
  });
  it('does not flag a normal busy day', () => assert.equal(volumeCheck(usual, 25).unusual, false));
  it('says nothing with too little history or a tiny count', () => {
    assert.equal(volumeCheck(usual.slice(0, 5), 60).unusual, false);
    assert.equal(volumeCheck(usual, 3).unusual, false);
  });
  it('one plain notice per office and day, with no codes', () => {
    const rows = [...days(usual), { office_id: 'O1', day: '2026-10-30', n: 60 }];
    const out = volumeNotices(rows, { now: new Date('2026-10-30T03:00:00Z') });
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'volume:o1:2026-10-30');
    assert.doesNotMatch(out[0].text, /[A-Z_]{4,}/);
  });
});
