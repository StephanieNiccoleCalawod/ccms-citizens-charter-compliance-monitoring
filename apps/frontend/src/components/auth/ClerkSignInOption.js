'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CLERK_SIGN_IN_PATH, PASSWORD_SIGN_IN_PATH, clerkEnabled } from '../../lib/auth/provider.js';

// Clerk sign-in (Landas 1): on the password sign-in page, a bar that offers the PUP account sign-in. Shown only while Clerk
// sign-in is on (NEXT_PUBLIC_AUTH_PROVIDER dual or clerk, with a publishable key). Kept out of the login page itself.
export default function ClerkSignInOption() {
  const pathname = usePathname();
  if (!clerkEnabled() || pathname !== PASSWORD_SIGN_IN_PATH) return null;
  return (
    <div className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-md flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">Have a PUP account?</p>
        <Link className="btn-primary" href={CLERK_SIGN_IN_PATH}>
          Sign in with your PUP account
        </Link>
      </div>
    </div>
  );
}
