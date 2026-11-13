import ClerkSignInOption from '../../components/auth/ClerkSignInOption.js';

// Wraps /login and /login/clerk. Adds only the "Sign in with your PUP account" bar on /login while Clerk sign-in is on;
// otherwise the pages render exactly as before.
export default function LoginLayout({ children }) {
  return (
    <>
      <ClerkSignInOption />
      {children}
    </>
  );
}
