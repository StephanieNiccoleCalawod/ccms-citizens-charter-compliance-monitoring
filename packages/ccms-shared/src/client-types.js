// CC047: client types per service (spec 8.1, decision K6). One contract for Core (storage and validation), Operations (the
// Start check against the authoritative Core answer) and the browser (the Start picker and the service form). No imports,
// so the browser bundle can use it through 'ccms-shared/client-types'.

/** Every client type, in the one canonical order used for storage and display. */
export const CLIENT_TYPE_LIST = Object.freeze(['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL']);

/** The registry status a client type is looked up under (CC044). Employee and External are never looked up. */
export const REGISTRY_STATUS_FOR_CLIENT_TYPE = Object.freeze({ STUDENT: 'ENROLLED', ALUMNI: 'ALUMNI' });

export const isRegistryClientType = (value) => Object.hasOwn(REGISTRY_STATUS_FOR_CLIENT_TYPE, value);

/**
 * Validates and normalises an allowed_client_types value from a request body.
 * Returns { value } with the distinct types in canonical order, or { error } with a readable message.
 * Duplicates are removed (not an error); null, a non-array, an empty array or any unknown/null element is an error.
 */
export function normaliseAllowedClientTypes(input) {
  if (!Array.isArray(input)) return { error: 'Choose at least one client type' };
  if (input.length === 0) return { error: 'Choose at least one client type' };
  if (input.length > 20 || input.some((type) => typeof type !== 'string' || !CLIENT_TYPE_LIST.includes(type))) {
    return { error: `Each client type must be one of ${CLIENT_TYPE_LIST.join(', ')}` };
  }
  const chosen = new Set(input);
  return { value: CLIENT_TYPE_LIST.filter((type) => chosen.has(type)) };
}

/**
 * Reads allowed_client_types from an authoritative Core answer during a rolling deployment.
 *   undefined (an older Core that does not know the field yet)  -> all four types, { legacy: true }
 *   a valid non-empty array                                       -> the normalised list
 *   anything else (null, empty, unknown or duplicate-only junk)   -> { error } : the caller must fail closed and never treat
 *                                                                    a malformed answer as "everyone may avail".
 */
export function readAllowedClientTypes(value) {
  if (value === undefined) return { value: [...CLIENT_TYPE_LIST], legacy: true };
  const { value: types, error } = normaliseAllowedClientTypes(value);
  if (error) return { error: 'The catalogue sent an unreadable list of client types' };
  return { value: types, legacy: false };
}
