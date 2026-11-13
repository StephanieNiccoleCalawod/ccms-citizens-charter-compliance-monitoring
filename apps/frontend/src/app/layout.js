import { DM_Sans, DM_Serif_Display } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import ClerkRegistrar from '../components/auth/ClerkRegistrar.js';
import { BRAND } from '../lib/constants/brand.js';
import { CLERK_SIGN_IN_PATH, PASSWORD_SIGN_IN_PATH, clerkEnabled, clerkPublishableKey } from '../lib/auth/provider.js';

// DM Serif Display is for each page's own title only (the <h1> in PageHeader, via the title-page utility).
// Regular weight is the only one the font has.
const dmSerifDisplay = DM_Serif_Display({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--font-dm-serif' });

// DM Sans is everything else (body text, section and card headings, buttons, tables, forms, modals): it is
// Tailwind's own --font-sans token (see globals.css), so the font-sans utility and the plain default body font both
// resolve to it. It is a variable font, so no weight list is needed.
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

export const metadata = {
  title: `${BRAND.system} | ${BRAND.campus}`,
  description: "Citizen's Charter Compliance/Monitoring System",
};

// Clerk sign-in (Landas 1): Clerk is loaded only when NEXT_PUBLIC_AUTH_PROVIDER is dual or clerk AND a publishable key is
// set (lib/auth/provider.js). Otherwise the page is exactly as before and no Clerk script is requested. Passing the key
// explicitly also keeps Clerk's "keyless" development mode from ever starting.
export default function RootLayout({ children }) {
  const content = clerkEnabled() ? (
    <ClerkProvider publishableKey={clerkPublishableKey()} signInUrl={CLERK_SIGN_IN_PATH} afterSignOutUrl={PASSWORD_SIGN_IN_PATH}>
      <ClerkRegistrar />
      {children}
    </ClerkProvider>
  ) : (
    children
  );
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${dmSans.variable}`}>
      <body>{content}</body>
    </html>
  );
}
