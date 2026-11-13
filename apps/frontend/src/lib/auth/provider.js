// Which sign-in the browser uses (Clerk sign-in, Landas 1). One public switch, read on use:
//   NEXT_PUBLIC_AUTH_PROVIDER = legacy (default) | dual | clerk
//     legacy  the email and password sign-in only; Clerk is never loaded
//     dual    both: the password sign-in page stays, and Clerk sign-in is at /login/clerk
//     clerk   Clerk sign-in only
//   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  the instance's publishable key (public by design). Without it, Clerk stays off.
// Next.js inlines NEXT_PUBLIC_ values at build time, so each one is read by its literal name.

export const CLERK_SIGN_IN_PATH = '/login/clerk';
export const ACCESS_PENDING_PATH = '/access-pending';
export const PASSWORD_SIGN_IN_PATH = '/login';

export function authProvider() {
  const value = String(process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? '').trim().toLowerCase();
  return value === 'clerk' || value === 'dual' ? value : 'legacy';
}

export function clerkPublishableKey() {
  return String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').trim();
}

/** Clerk is loaded only when the switch asks for it AND a publishable key is set. */
export function clerkEnabled() {
  return authProvider() !== 'legacy' && /^pk_(test|live)_/.test(clerkPublishableKey());
}

/** Where a signed-out person is sent: the Clerk page when Clerk is the only sign-in, otherwise the password page. */
export function signInPath() {
  return authProvider() === 'clerk' && clerkEnabled() ? CLERK_SIGN_IN_PATH : PASSWORD_SIGN_IN_PATH;
}
