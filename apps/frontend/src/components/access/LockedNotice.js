import Link from 'next/link';
import { lockedNotice } from '../../lib/ui/access.js';

/**
 * "You don't have access to this yet. Request access": shown in place of a feature the person's role does not include.
 * Only an Office Head or Office Staff sees it (the Super Admin and the Executive cannot ask); the button opens the request form with that permission chosen.
 */
export default function LockedNotice({ permissionKey, role, message, className = '' }) {
  const notice = lockedNotice(permissionKey, role, message);
  if (!notice) return null;
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`.trim()} data-testid="locked-notice">
      <p>{notice.message}</p>
      <Link href={notice.href} className="btn-secondary btn-sm" data-testid="request-access-link">{notice.action}</Link>
    </div>
  );
}
