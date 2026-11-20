// toManilaDate has a fast path for 2000-2100 (a fixed UTC+08:00 with no daylight saving). It must agree with the general
// Intl-based calendar parts everywhere, above all at the Manila midnight boundaries.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { manilaParts, toManilaDate } from '../src/time.js';

const pad = (n, width = 2) => String(n).padStart(width, '0');
const general = (value) => {
  const p = manilaParts(value);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
};
const DAY = 86_400_000;

describe('toManilaDate fast path', () => {
  it('agrees with the Intl-based date one millisecond either side of every Manila midnight in 1999-2101', () => {
    for (let midnight = Date.UTC(1999, 11, 30, 16, 0, 0); midnight < Date.UTC(2101, 0, 2); midnight += DAY) {
      for (const at of [midnight - 1, midnight, midnight + 1]) assert.equal(toManilaDate(at), general(at), new Date(at).toISOString());
    }
  });

  it('agrees on a deterministic spread of instants, including leap days and the year ends', () => {
    let seed = 12345;
    const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    const from = Date.UTC(1990, 0, 1);
    const span = Date.UTC(2110, 0, 1) - from;
    for (let i = 0; i < 20_000; i++) {
      const at = from + Math.floor(next() * span);
      assert.equal(toManilaDate(at), general(at), new Date(at).toISOString());
    }
    for (const iso of ['2000-02-29T20:00:00Z', '2024-02-29T15:59:59Z', '2026-12-31T16:00:00Z', '2099-12-31T15:59:59Z', '2100-01-01T00:00:00Z']) {
      assert.equal(toManilaDate(iso), general(iso), iso);
    }
  });

  it('accepts a Date, an ISO string or a number, and still rejects an invalid date', () => {
    const at = Date.UTC(2026, 9, 31, 16, 0, 0);
    assert.equal(toManilaDate(new Date(at)), '2026-11-01');
    assert.equal(toManilaDate(new Date(at).toISOString()), '2026-11-01');
    assert.equal(toManilaDate(at), '2026-11-01');
    assert.throws(() => toManilaDate('not a date'), RangeError);
  });
});
