// Identity (sign-in, sessions, accounts) as the browser calls it, through the gateway.
// Sign-in, refresh and sign-out themselves live in lib/auth/session.js.

export const IDENTITY_API = '/api/identity';
export const ACCOUNTS_API = `${IDENTITY_API}/accounts`;
export const PASSWORD_RESET_CONFIRM_API = `${IDENTITY_API}/auth/password-reset/confirm`;

// CC056 — the signed-in person's own account, and the four staff permission switches (Super Admin).
//   GET /api/identity/me                   -> { account, what_i_can_do: [{ key, group, label, access, switch_key, switch_on }] }
//   PUT /api/identity/me/password          { current_password, new_password } -> 200; 400 with details by field
//   GET /api/identity/permission-switches  -> { switches: [{ key, label, description, enabled, updated_by, updated_at }], matrix: { roles, rows } }
//   PUT /api/identity/permission-switches  { switches: { KEY: true|false } } -> the same view
export const ME_API = `${IDENTITY_API}/me`;
export const MY_PASSWORD_API = `${IDENTITY_API}/me/password`;
export const PERMISSION_SWITCHES_API = `${IDENTITY_API}/permission-switches`;
