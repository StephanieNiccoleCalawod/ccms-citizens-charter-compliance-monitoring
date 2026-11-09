import { createCoreClient } from './core-client.js';
import { createIdentityClient } from './identity-client.js';

/** What the routes use at run time: the Core client (built from the environment on every call) and the clock. */
export function runtimeDeps() {
  return { core: createCoreClient(), identity: createIdentityClient(), now: () => new Date() };
}
