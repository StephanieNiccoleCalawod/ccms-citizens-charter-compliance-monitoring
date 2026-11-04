// A small registry of "does this open form have unsaved changes?" checks, so Sign out can warn before
// throwing work away. Forms register while their modal is open and unregister when it closes.

/** A separate registry (used by tests); the app uses the shared one below. */
export function createDirtyRegistry() {
  const entries = new Map();

  /** Adds or replaces the check for id. Returns a disposer that removes only this registration. */
  function register(id, isDirtyFn) {
    if (typeof isDirtyFn !== 'function') throw new TypeError('isDirtyFn must be a function');
    entries.set(id, isDirtyFn);
    return () => {
      // A later registration under the same id (React Strict Mode re-runs effects) must survive.
      if (entries.get(id) === isDirtyFn) entries.delete(id);
    };
  }

  function unregister(id) {
    entries.delete(id);
  }

  function isAnyDirty() {
    for (const isDirtyFn of entries.values()) {
      try {
        if (isDirtyFn()) return true;
      } catch {
        /* a broken check must not block sign-out; treat it as clean */
      }
    }
    return false;
  }

  return { register, unregister, isAnyDirty, size: () => entries.size };
}

const shared = createDirtyRegistry();
export const register = shared.register;
export const unregister = shared.unregister;
export const isAnyDirty = shared.isAnyDirty;

const same = (a, b) => Object.is(a, b) || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** True when any field of current differs from initial (keys of both are compared). */
export function hasChanges(initial, current) {
  if (initial === current) return false;
  if (!initial || !current) return true;
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const key of keys) if (!same(initial[key], current[key])) return true;
  return false;
}
