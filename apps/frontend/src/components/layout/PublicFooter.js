import Link from 'next/link';
import { BRAND } from '../../lib/constants/brand.js';
import { CONTACT, PRIVACY_PATH, charterReference, copyrightLine } from '../../lib/constants/contact.js';
import BrandMark from '../ui/BrandMark.js';

function formatFooterPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits === '282878204') return '(02) 8287-8204';
  return phone;
}

function formatFooterWebsite(url) {
  return String(url ?? '')
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/+$/, '');
}

function ContactIconBadge({ children }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FFF1F2] text-[#800000]"
    >
      {children}
    </span>
  );
}

// The footer of the public pages (S8-16 / D8-12): university name and logo, a working contact, the privacy notice, a copyright line and,
// once confirmed, the link to PUP's published Citizen's Charter. No social media and no outside trackers.
export default function PublicFooter() {
  const charter = charterReference();
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white" data-testid="public-footer">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 px-4 py-10 text-sm text-slate-700 sm:px-8 md:flex-row md:items-start lg:px-12">
        <div className="flex max-w-md items-start gap-3.5">
          <BrandMark size={44} />
          <div>
            <p className="text-base font-bold leading-snug text-slate-900">{CONTACT.university}</p>
            <p className="mt-0.5 text-sm text-slate-600">{BRAND.fullName}</p>
          </div>
        </div>

        <address className="not-italic">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-900">
            Contact &amp; Campus Location
          </p>
          <ul className="mt-3.5 space-y-2.5 text-sm text-slate-700">
            <li className="flex items-center gap-3">
              <ContactIconBadge>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </ContactIconBadge>
              <a className="text-slate-700 transition hover:text-[#800000] hover:underline" href={`mailto:${CONTACT.email}`}>
                {CONTACT.email}
              </a>
            </li>
            <li className="flex items-center gap-3">
              <ContactIconBadge>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </ContactIconBadge>
              <a className="font-mono text-[13px] text-slate-700 transition hover:text-[#800000] hover:underline" href={`tel:${CONTACT.phone}`}>
                {formatFooterPhone(CONTACT.phone)}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5">
                <ContactIconBadge>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </ContactIconBadge>
              </span>
              <span className="max-w-xs leading-relaxed text-slate-700">{CONTACT.address}</span>
            </li>
            <li className="flex items-center gap-3">
              <ContactIconBadge>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
              </ContactIconBadge>
              <a
                className="inline-flex items-center gap-1.5 text-slate-700 transition hover:text-[#800000] hover:underline"
                href={CONTACT.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{formatFooterWebsite(CONTACT.website)}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </address>
      </div>

      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-600 sm:px-8 lg:px-12">
          <p>{copyrightLine()}</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {charter ? (
              <span data-testid="charter-note">
                <a className="underline" href={charter.url} target="_blank" rel="noopener noreferrer">PUP Citizen&apos;s Charter</a>{' '}
                <span>{charter.note}</span>
              </span>
            ) : null}
            <Link className="underline hover:text-slate-900" href={PRIVACY_PATH}>Privacy notice</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
