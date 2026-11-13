// Hands the loaded Clerk instance from React (ClerkRegistrar, inside ClerkProvider) to the plain session module, so
// session.js never imports React or the Clerk SDK and stays testable on its own.

import { clerkEnabled } from './provider.js';

const LOAD_TIMEOUT_MS = 10_000;
let instance = null;
let waiters = [];

/** Called by ClerkRegistrar once Clerk has loaded. Tests pass a fake. */
export function registerClerk(clerk) {
  instance = clerk ?? null;
  if (!instance) return;
  for (const resolve of waiters) resolve(instance);
  waiters = [];
}

/**
 * The loaded Clerk instance. null when Clerk is switched off. Rejects with CLERK_UNAVAILABLE when Clerk does not load in
 * time (blocked script, no network): that is "cannot reach sign-in", not "signed out".
 */
export function whenClerk(timeoutMs = LOAD_TIMEOUT_MS) {
  if (!clerkEnabled()) return Promise.resolve(null);
  if (instance) return Promise.resolve(instance);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      reject(Object.assign(new Error('Clerk did not load'), { code: 'CLERK_UNAVAILABLE' }));
    }, timeoutMs);
    function done(clerk) {
      clearTimeout(timer);
      resolve(clerk);
    }
    waiters.push(done);
  });
}
