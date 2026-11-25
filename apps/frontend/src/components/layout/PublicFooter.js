import Link from 'next/link';
import { BRAND } from '../../lib/constants/brand.js';
import { CONTACT, PRIVACY_PATH, charterReference, copyrightLine } from '../../lib/constants/contact.js';
import BrandMark from '../ui/BrandMark.js';

// The footer of the public pages (S8-16 / D8-12): university name and logo, a working contact, the privacy notice, a copyright line and,
// once confirmed, the link to PUP's published Citizen's Charter. No social media and no outside trackers.
export default function PublicFooter() {
  const charter = charterReference();
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white" data-testid="public-footer">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 text-sm text-slate-700 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <BrandMark size={40} />
          <div>
            <p className="font-semibold text-slate-900">{CONTACT.university}</p>
            <p className="text-slate-600">{BRAND.fullName}</p>
          </div>
        </div>
        <address className="not-italic">
          <p className="font-semibold text-slate-900">Contact us</p>
          <p><a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p>
          <p>Phone: <a className="underline" href={`tel:${CONTACT.phone}`}>{CONTACT.phone}</a></p>
          <p>{CONTACT.address}</p>
          <p><a className="underline" href={CONTACT.website} target="_blank" rel="noopener noreferrer">PUP Quezon City website</a></p>
        </address>
      </div>
      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-600">
          <p>{copyrightLine()}</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {charter ? (
              <span data-testid="charter-note">
                <a className="underline" href={charter.url} target="_blank" rel="noopener noreferrer">PUP Citizen&apos;s Charter</a>{' '}
                <span>{charter.note}</span>
              </span>
            ) : null}
            <Link className="underline" href={PRIVACY_PATH}>Privacy notice</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
