import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDirtyRegistry, hasChanges, isAnyDirty, register, unregister } from '../../src/lib/ui/dirty-registry.js';

describe('dirty registry', () => {
  it('is clean with nothing registered', () => {
    assert.equal(createDirtyRegistry().isAnyDirty(), false);
  });

  it('registers and unregisters a form', () => {
    const registry = createDirtyRegistry();
    registry.register('a', () => true);
    assert.equal(registry.isAnyDirty(), true);
    registry.unregister('a');
    assert.equal(registry.isAnyDirty(), false);
    assert.equal(registry.size(), 0);
  });

  it('an open but pristine form is not dirty', () => {
    const registry = createDirtyRegistry();
    registry.register('a', () => false);
    assert.equal(registry.isAnyDirty(), false);
  });

  it('is dirty when any of several forms is dirty, and reads the live value', () => {
    const registry = createDirtyRegistry();
    let bDirty = false;
    registry.register('a', () => false);
    registry.register('b', () => bDirty);
    assert.equal(registry.isAnyDirty(), false);
    bDirty = true;
    assert.equal(registry.isAnyDirty(), true);
    bDirty = false;
    assert.equal(registry.isAnyDirty(), false);
  });

  it('re-registering an id replaces the old check (no duplicates)', () => {
    const registry = createDirtyRegistry();
    registry.register('a', () => true);
    registry.register('a', () => false);
    assert.equal(registry.size(), 1);
    assert.equal(registry.isAnyDirty(), false);
  });

  it("a stale disposer does not remove a newer registration (Strict Mode re-runs)", () => {
    const registry = createDirtyRegistry();
    const disposeOld = registry.register('a', () => true);
    registry.register('a', () => true);
    disposeOld();
    assert.equal(registry.isAnyDirty(), true);
    assert.equal(registry.size(), 1);
  });

  it('the disposer removes its own registration (unmount)', () => {
    const registry = createDirtyRegistry();
    const dispose = registry.register('a', () => true);
    dispose();
    dispose();
    assert.equal(registry.size(), 0);
  });

  it('a throwing check counts as clean', () => {
    const registry = createDirtyRegistry();
    registry.register('a', () => {
      throw new Error('boom');
    });
    assert.equal(registry.isAnyDirty(), false);
  });

  it('rejects a non-function check', () => {
    assert.throws(() => createDirtyRegistry().register('a', true), TypeError);
  });

  it('the shared registry exposes register / unregister / isAnyDirty', () => {
    register('shared-test', () => true);
    assert.equal(isAnyDirty(), true);
    unregister('shared-test');
    assert.equal(isAnyDirty(), false);
  });
});

describe('hasChanges (form values vs. the values it opened with)', () => {
  it('is false for identical values and true for any changed field', () => {
    const initial = { name: 'A', is_recurring: false, office_id: '' };
    assert.equal(hasChanges(initial, { ...initial }), false);
    assert.equal(hasChanges(initial, { ...initial, name: 'B' }), true);
    assert.equal(hasChanges(initial, { ...initial, is_recurring: true }), true);
    assert.equal(hasChanges(initial, { ...initial, extra: 'x' }), true);
  });

  it('changing a field and changing it back is clean again', () => {
    const initial = { name: 'A' };
    assert.equal(hasChanges(initial, { name: 'A' }), false);
  });

  it('compares nested values by content', () => {
    assert.equal(hasChanges({ tags: ['a'] }, { tags: ['a'] }), false);
    assert.equal(hasChanges({ tags: ['a'] }, { tags: ['b'] }), true);
  });
});
