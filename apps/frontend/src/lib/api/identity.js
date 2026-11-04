// Identity (sign-in, sessions, accounts) as the browser calls it, through the gateway.
// Sign-in, refresh and sign-out themselves live in lib/auth/session.js.

export const IDENTITY_API = '/api/identity';
export const ACCOUNTS_API = `${IDENTITY_API}/accounts`;
export const PASSWORD_RESET_CONFIRM_API = `${IDENTITY_API}/auth/password-reset/confirm`;
