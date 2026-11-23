import Link from 'next/link';
import BrandMark from '../ui/BrandMark.js';
import { BRAND } from '../../lib/constants/brand.js';
import { PUBLIC_CONTACT, PUBLIC_FOOTER_LINKS, copyrightLine } from '../../lib/ui/public-footer.js';

// One small footer for the signed-out public pages (S8-16): whose system this is, a few real links, the copyright line.
// tone "dark" sits on the maroon landing page, "light" on the cream directory.
export default function PublicFooter({ tone = 'light' }) {
  const dark = tone === 'dark';
  const text = dark ? 'text-white/85' : 'text-[#475569]';
  const line = dark ? 'border-white/20' : 'border-[#E2E8F0]';
  const link = dark ? 'text-white hover:underline focus-visible:ring-[#FFDF00]' : 'text-[#800000] hover:underline focus-visible:ring-[#800000]';
  return (
    <footer data-testid="public-footer" className={`border-t ${line} ${text}`}>
      <div className="mx-auto flex max-w-[90rem] flex-col gap-4 px-4 py-6 text-sm sm:px-8 md:flex-row md:items-center md:justify-between lg:px-16">
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <p className="min-w-0">
            <span className="block font-semibold">{BRAND.campus} &middot; {BRAND.system}</span>
            <span className="block text-xs">{BRAND.fullName}</span>
          </p>
        </div>
        <nav aria-label="Public pages">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {PUBLIC_FOOTER_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={`inline-flex min-h-6 items-center rounded font-semibold focus:outline-none focus-visible:ring-2 ${link}`}>{item.label}</Link>
              </li>
            ))}
            {PUBLIC_CONTACT ? <li><a href={PUBLIC_CONTACT.href} className={`inline-flex min-h-6 items-center rounded font-semibold focus:outline-none focus-visible:ring-2 ${link}`}>{PUBLIC_CONTACT.label}</a></li> : null}
          </ul>
        </nav>
        <p className="text-xs" data-testid="public-footer-copyright">{copyrightLine()}</p>
      </div>
    </footer>
  );
}
