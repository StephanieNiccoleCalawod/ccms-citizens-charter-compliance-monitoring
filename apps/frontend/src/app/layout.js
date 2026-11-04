import { DM_Sans, DM_Serif_Display } from 'next/font/google';
import './globals.css';
import { BRAND } from '../lib/constants/brand.js';

// DM Serif Display is for headings only (h1-h3 use it through the font-serif utility). Everything
// else stays on the sans-serif stack. Regular weight is the only one the font has.
const dmSerifDisplay = DM_Serif_Display({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--font-dm-serif' });

// DM Sans is the sidebar's font (see AppShell). It is a variable font, so no weight list is needed.
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

export const metadata = {
  title: `${BRAND.system} | ${BRAND.campus}`,
  description: "Citizen's Charter Compliance/Monitoring System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
