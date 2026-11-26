// Settings scrollspy: which section counts as "active" from the set currently visible.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { pickActiveId } from '../../src/lib/ui/scroll-spy.js';

describe('pickActiveId', () => {
  it('picks the latest id (in order) that is visible: at a seam, the one just scrolled to wins', () => {
    assert.equal(pickActiveId(['a', 'b', 'c'], { a: true, b: false, c: false }), 'a');
    assert.equal(pickActiveId(['a', 'b', 'c'], { a: true, b: true, c: false }), 'b');
    assert.equal(pickActiveId(['a', 'b', 'c'], { a: false, b: true, c: true }), 'c');
    assert.equal(pickActiveId(['a', 'b', 'c'], { a: false, b: false, c: true }), 'c');
  });
  it('is null when nothing is visible, never defaulting to the first id', () => {
    assert.equal(pickActiveId(['a', 'b'], {}), null);
    assert.equal(pickActiveId(['a', 'b'], { a: false, b: false }), null);
  });
});
